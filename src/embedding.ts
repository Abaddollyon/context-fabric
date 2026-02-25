// Wrapper around fastembed-js for consistent embeddings

import { FlagEmbedding, EmbeddingModel } from 'fastembed';

export class EmbeddingService {
  private model: FlagEmbedding | null = null;
  private cache: Map<string, number[]> = new Map();
  private modelName: EmbeddingModel;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(modelName: EmbeddingModel = EmbeddingModel.BGESmallEN) {
    this.modelName = modelName;
  }

  /**
   * Initialize the embedding model
   */
  private async init(): Promise<void> {
    if (this.initialized) return;
    
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      // FASTEMBED_CACHE_PATH lets Docker point to the baked-in model,
      // falling back to fastembed's own default cache when running locally.
      const cacheDir = process.env.FASTEMBED_CACHE_PATH || undefined;
      this.model = await FlagEmbedding.init({
        model: this.modelName,
        cacheDir,
      });
      this.initialized = true;
    })();

    return this.initPromise;
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

    // Generate embedding - fastembed yields batches of (Float32Array | number[])
    const embeddings: (Float32Array | number[])[] = [];
    for await (const embedding of this.model.embed([text])) {
      const emb = embedding as unknown;
      const isNestedArray = Array.isArray(emb) && emb.length > 0 &&
        (Array.isArray((emb as unknown[])[0]) || (emb as unknown[])[0] instanceof Float32Array);
      if (isNestedArray) {
        // It's a batch: Array of (number[] | Float32Array)
        for (const e of emb as (number[] | Float32Array)[]) {
          embeddings.push(e);
        }
      } else {
        // It's a single embedding (number[] or Float32Array)
        embeddings.push(emb as Float32Array | number[]);
      }
    }

    if (embeddings.length === 0) {
      throw new Error('Failed to generate embedding');
    }

    const result = this.normalizeEmbedding(embeddings[0]);
    
    // Cache the result
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
      const embeddings: (Float32Array | number[])[] = [];
      for await (const embedding of this.model.embed(uncachedTexts)) {
        const emb = embedding as unknown;
        const isNestedArray = Array.isArray(emb) && emb.length > 0 &&
          (Array.isArray((emb as unknown[])[0]) || (emb as unknown[])[0] instanceof Float32Array);
        if (isNestedArray) {
          // It's a batch: Array of (number[] | Float32Array)
          for (const e of emb as (number[] | Float32Array)[]) {
            embeddings.push(e);
          }
        } else {
          // It's a single embedding (number[] or Float32Array)
          embeddings.push(emb as Float32Array | number[]);
        }
      }

      // Store in cache and results
      for (let i = 0; i < uncachedTexts.length; i++) {
        const embedding = this.normalizeEmbedding(embeddings[i]);
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
