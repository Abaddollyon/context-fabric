// Wrapper around fastembed-js for consistent embeddings

import { FlagEmbedding, EmbeddingModel } from 'fastembed';

const MAX_CACHE_SIZE = 10_000;

/**
 * Process-wide cache of loaded ONNX models keyed by `${modelName}|${cacheDir}`.
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
  const key = `${modelName}|${cacheDir ?? ''}`;
  let p = modelCache.get(key);
  if (!p) {
    p = FlagEmbedding.init({ model: modelName, cacheDir });
    modelCache.set(key, p);
    // On failure, drop the rejected promise so the next caller can retry.
    p.catch(() => modelCache.delete(key));
  }
  return p;
}

export class EmbeddingService {
  private model: FlagEmbedding | null = null;
  private cache: Map<string, number[]> = new Map();
  private modelName: EmbeddingModel;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private initFailed: boolean = false;
  private timeoutMs: number;

  constructor(modelName: EmbeddingModel = EmbeddingModel.BGESmallEN, timeoutMs = 30_000) {
    this.modelName = modelName;
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
