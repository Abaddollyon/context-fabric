// Wrapper around fastembed-js for consistent embeddings

import { FlagEmbedding, EmbeddingModel, ExecutionProvider } from 'fastembed';

const MAX_CACHE_SIZE = 10_000;

/**
 * Resolve the list of ONNX execution providers from the `CONTEXT_FABRIC_EMBED_EP`
 * env var. Accepts a comma-separated list of provider names (case-insensitive):
 *
 *   cpu                (default)
 *   cuda               (requires CUDA 12 runtime + cuBLAS + cuDNN on LD_LIBRARY_PATH)
 *   cuda,cpu           (CUDA with graceful CPU fallback on session init failure)
 *
 * Unknown names are dropped with a warning. An empty/invalid env var falls back
 * to `[CPU]`.
 */
function resolveExecutionProviders(): ExecutionProvider[] {
  const raw = process.env.CONTEXT_FABRIC_EMBED_EP;
  if (!raw || !raw.trim()) return [ExecutionProvider.CPU];

  const out: ExecutionProvider[] = [];
  const known: Record<string, ExecutionProvider> = {
    cpu: ExecutionProvider.CPU,
    cuda: ExecutionProvider.CUDA,
  };
  for (const rawName of raw.split(',')) {
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    const resolved = known[name];
    if (resolved) {
      out.push(resolved);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[embedding] Unknown execution provider '${name}' in CONTEXT_FABRIC_EMBED_EP — ignoring.`,
      );
    }
  }
  return out.length > 0 ? out : [ExecutionProvider.CPU];
}

/**
 * Resolve the default embedding model from `CONTEXT_FABRIC_EMBED_MODEL`.
 * Accepts (case-insensitive) any enum key exported by fastembed's
 * `EmbeddingModel`, e.g. `BGESmallEN`, `BGESmallENV15`, `BGEBaseEN`,
 * `BGEBaseENV15`, `AllMiniLML6V2`, `MLE5Large`.
 *
 * Notes:
 *  - bge-large-en-v1.5 is NOT shipped by fastembed-js (the package only
 *    ships base-size BGE models). To use a larger encoder, wire an
 *    alternative loader (e.g. @huggingface/transformers).
 *  - Changing the model changes the embedding dimension, which is baked
 *    into the sqlite-vec virtual table. Always use a fresh L3 DB when
 *    switching models.
 */
function resolveEmbeddingModel(): EmbeddingModel {
  const raw = process.env.CONTEXT_FABRIC_EMBED_MODEL;
  if (!raw || !raw.trim()) return EmbeddingModel.BGESmallENV15;
  const key = raw.trim();
  // Build a case-insensitive lookup of the enum keys that produce non-numeric values.
  const table = Object.entries(EmbeddingModel)
    .filter(([k, v]) => typeof v === 'string' && isNaN(Number(k)))
    .reduce<Record<string, EmbeddingModel>>((acc, [k, v]) => {
      acc[k.toLowerCase()] = v as EmbeddingModel;
      return acc;
    }, {});
  const resolved = table[key.toLowerCase()];
  if (!resolved) {
    // eslint-disable-next-line no-console
    console.warn(
      `[embedding] Unknown embedding model '${key}' in CONTEXT_FABRIC_EMBED_MODEL — ` +
        `falling back to BGESmallENV15. Valid names: ${Object.keys(table).join(', ')}`,
    );
    return EmbeddingModel.BGESmallENV15;
  }
  return resolved;
}

/**
 * Process-wide cache of loaded ONNX models keyed by
 * `${modelName}|${cacheDir}|${executionProviders}`.
 *
 * The ONNX runtime load is the single heaviest cost in the server (~250ms
 * cold + ~80ms model tensor parse). Previously every `SemanticMemoryLayer`
 * instance created its own `EmbeddingService`, which loaded the model from
 * scratch — with 37 test files × ~2 layer instantiations per file, that was
 * ~20s of avoidable model init per full test run. Sharing the handle is
 * safe because `FlagEmbedding.embed()` is stateless w.r.t. prior calls.
 *
 * Each `EmbeddingService` still keeps its own per-instance text→vector
 * cache so test isolation on the caching layer is preserved.
 */
const modelCache = new Map<string, Promise<FlagEmbedding>>();

function getOrLoadModel(
  modelName: EmbeddingModel,
  cacheDir: string | undefined,
): Promise<FlagEmbedding> {
  const executionProviders = resolveExecutionProviders();
  const key = `${modelName}|${cacheDir ?? ''}|${executionProviders.join(',')}`;
  let p = modelCache.get(key);
  if (!p) {
    p = FlagEmbedding.init({ model: modelName, cacheDir, executionProviders });
    modelCache.set(key, p);
    // On failure, drop the rejected promise so the next caller can retry.
    p.catch(() => modelCache.delete(key));
  }
  return p;
}

/**
 * Per-model prefix pair applied at encode time.
 *
 * Retrieval models are trained with asymmetric encoders: queries and
 * passages get different instruction prefixes so the model can encode
 * them into the same space despite their structural asymmetry
 * (e.g. a short question vs a long paragraph).
 *
 * Using the wrong prefix (or no prefix when one was trained in) collapses
 * retrieval quality — we saw an 8 nDCG@10-point regression on BEIR FiQA
 * when passages had no prefix and queries had no prefix, even though they
 * were at least *consistent*. The published bge-base-en-v1.5 numbers on
 * FiQA (0.406) assume the `"Represent this sentence…"` query prefix.
 *
 * Sources:
 *   - BGE family: https://huggingface.co/BAAI/bge-small-en-v1.5#usage
 *     (query prefix only; passages have no prefix)
 *   - E5 family:  https://huggingface.co/intfloat/multilingual-e5-large
 *     (`"query: "` and `"passage: "` on both sides)
 *   - MiniLM (symmetric): https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 *     (no prefixes — same encoder for queries and passages)
 */
interface ModelPrefixes {
  readonly query: string;
  readonly passage: string;
}

function prefixesFor(model: EmbeddingModel): ModelPrefixes {
  switch (model) {
    case EmbeddingModel.BGESmallEN:
    case EmbeddingModel.BGESmallENV15:
    case EmbeddingModel.BGEBaseEN:
    case EmbeddingModel.BGEBaseENV15:
    case EmbeddingModel.BGESmallZH:
      // BGE is asymmetric: instruction on the query side only.
      return {
        query: 'Represent this sentence for searching relevant passages: ',
        passage: '',
      };
    case EmbeddingModel.MLE5Large:
      // E5 family uses symmetric `query:` / `passage:` tags.
      return { query: 'query: ', passage: 'passage: ' };
    case EmbeddingModel.AllMiniLML6V2:
    default:
      // Symmetric sentence-transformer: no prefixes.
      return { query: '', passage: '' };
  }
}

export class EmbeddingService {
  private model: FlagEmbedding | null = null;
  private cache: Map<string, number[]> = new Map();
  private modelName: EmbeddingModel;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private initFailed: boolean = false;
  private timeoutMs: number;

  constructor(modelName?: EmbeddingModel, timeoutMs = 30_000) {
    this.modelName = modelName ?? resolveEmbeddingModel();
    this.timeoutMs = timeoutMs;
  }

  /**
   * Races a promise against a timeout rejection.
   */
  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`EmbeddingService: ${label} timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * Initialize the embedding model.
   * Uses a circuit breaker: if init fails once, subsequent calls throw
   * immediately instead of retrying forever.
   */
  private async init(): Promise<void> {
    if (this.initialized) return;

    if (this.initFailed) {
      throw new Error('Embedding model initialization previously failed. Restart the server to retry.');
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      // FASTEMBED_CACHE_PATH lets Docker point to the baked-in model,
      // falling back to fastembed's own default cache when running locally.
      const cacheDir = process.env.FASTEMBED_CACHE_PATH || undefined;
      // Share the loaded model across all EmbeddingService instances in
      // the process. See the modelCache comment in this file for rationale.
      this.model = await this.withTimeout(
        getOrLoadModel(this.modelName, cacheDir),
        'model initialization'
      );
      this.initialized = true;
    })();

    try {
      return await this.initPromise;
    } catch (err) {
      this.initFailed = true;
      this.initPromise = null;
      throw err;
    }
  }

  /**
   * Evict the oldest cache entry when the cache exceeds MAX_CACHE_SIZE.
   * Map preserves insertion order, so the first key is the oldest.
   */
  private evictIfNeeded(): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }

  /**
   * Convert embedding to regular number array
   * (handles Float32Array and other typed arrays)
   */
  private normalizeEmbedding(embedding: Float32Array | number[]): number[] {
    if (Array.isArray(embedding)) {
      return embedding;
    }
    // Convert Float32Array to regular array
    return Array.from(embedding);
  }

  /**
   * Consume the async generator from model.embed() into a flat array of raw embeddings.
   */
  private async collectEmbeddings(
    gen: AsyncIterable<unknown>
  ): Promise<(Float32Array | number[])[]> {
    const embeddings: (Float32Array | number[])[] = [];
    for await (const embedding of gen) {
      const emb = embedding as unknown;
      const isNestedArray =
        Array.isArray(emb) &&
        emb.length > 0 &&
        (Array.isArray((emb as unknown[])[0]) || (emb as unknown[])[0] instanceof Float32Array);
      if (isNestedArray) {
        for (const e of emb as (number[] | Float32Array)[]) {
          embeddings.push(e);
        }
      } else {
        embeddings.push(emb as Float32Array | number[]);
      }
    }
    return embeddings;
  }

  /**
   * Embed single text
   */
  async embed(text: string): Promise<number[]> {
    await this.init();

    // Check cache — true LRU: on hit, re-insert to bump recency.
    const cached = this.cache.get(text);
    if (cached) {
      this.cache.delete(text);
      this.cache.set(text, cached);
      return cached;
    }

    if (!this.model) {
      throw new Error('Embedding model not initialized');
    }

    // Generate embedding with timeout guard
    const embeddings = await this.withTimeout(
      this.collectEmbeddings(this.model.embed([text])),
      'embed()'
    );

    if (embeddings.length === 0) {
      throw new Error('Failed to generate embedding');
    }

    const result = this.normalizeEmbedding(embeddings[0]);

    // Cache the result (with LRU eviction)
    this.evictIfNeeded();
    this.cache.set(text, result);

    return result;
  }

  /**
   * Embed batch of texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();

    if (!this.model) {
      throw new Error('Embedding model not initialized');
    }

    // Check cache for each text
    const results: (number[] | undefined)[] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        // True LRU: bump recency on hit so batch lookups don't shift
        // hot entries toward eviction.
        this.cache.delete(texts[i]);
        this.cache.set(texts[i], cached);
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      const embeddings = await this.withTimeout(
        this.collectEmbeddings(this.model.embed(uncachedTexts)),
        'embedBatch()'
      );

      // Store in cache and results (with LRU eviction)
      for (let i = 0; i < uncachedTexts.length; i++) {
        const embedding = this.normalizeEmbedding(embeddings[i]);
        this.evictIfNeeded();
        this.cache.set(uncachedTexts[i], embedding);
        results[uncachedIndices[i]] = embedding;
      }
    }

    return results as number[][];
  }

  /**
   * Embed a retrieval **query** — applies the model's query-side instruction
   * prefix (see `prefixesFor`). Use this whenever the text is a question
   * or search term that will be compared against previously-stored passages.
   *
   * Caches are keyed on the *prefixed* text so query and passage embeddings
   * of the same raw string never collide in the LRU.
   *
   * For symmetric models (AllMiniLML6V2) the prefix is empty, making this
   * method behaviorally identical to `embed()`.
   */
  async embedQuery(text: string): Promise<number[]> {
    const { query } = prefixesFor(this.modelName);
    return this.embed(query + text);
  }

  /**
   * Embed an array of **queries** with the model's query-side prefix applied
   * to each item. See `embedQuery` for motivation.
   */
  async embedQueryBatch(texts: string[]): Promise<number[][]> {
    const { query } = prefixesFor(this.modelName);
    if (!query) return this.embedBatch(texts);
    return this.embedBatch(texts.map((t) => query + t));
  }

  /**
   * Embed a **passage / document** — applies the model's passage-side prefix
   * (empty for BGE, `"passage: "` for E5). Doc-ingest paths should route
   * through this method rather than calling `embed()` directly so we stay
   * consistent with the encoder's training regime.
   *
   * For BGE models this is behaviorally identical to `embed()` (empty
   * prefix), but we keep the method so callers express intent and we can
   * safely swap encoders later without touching ingest code.
   */
  async embedPassage(text: string): Promise<number[]> {
    const { passage } = prefixesFor(this.modelName);
    if (!passage) return this.embed(text);
    return this.embed(passage + text);
  }

  /**
   * Batch variant of `embedPassage`. Use on the hot ingest path.
   */
  async embedPassageBatch(texts: string[]): Promise<number[][]> {
    const { passage } = prefixesFor(this.modelName);
    if (!passage) return this.embedBatch(texts);
    return this.embedBatch(texts.map((t) => passage + t));
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    // BGESmallEN has 384 dimensions
    // BGEBaseEN has 768 dimensions
    switch (this.modelName) {
      case EmbeddingModel.BGESmallEN:
      case EmbeddingModel.BGESmallENV15:
        return 384;
      case EmbeddingModel.BGEBaseEN:
      case EmbeddingModel.BGEBaseENV15:
        return 768;
      // Nomic models not available in all fastembed versions
      // case EmbeddingModel.NomicEmbedTextV1:
      // case EmbeddingModel.NomicEmbedTextV15:
      //   return 768;
      default:
        return 384; // Default to most common
    }
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

export default EmbeddingService;
