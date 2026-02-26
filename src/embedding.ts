// Wrapper around fastembed-js for consistent embeddings

import { FlagEmbedding, EmbeddingModel } from 'fastembed';

const MAX_CACHE_SIZE = 10_000;

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
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`EmbeddingService: ${label} timed out after ${this.timeoutMs}ms`)),
          this.timeoutMs
        )
      ),
    ]);
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
      this.model = await this.withTimeout(
        FlagEmbedding.init({ model: this.modelName, cacheDir }),
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

    // Check cache
    const cached = this.cache.get(text);
    if (cached) {
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
