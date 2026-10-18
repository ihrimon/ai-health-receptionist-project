import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Embedder = (
  text: string,
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ data: ArrayLike<number> }>;

/**
 * M7-32: how many recent question embeddings are kept in memory. Visitors
 * ask the same things ("opening hours?"), and one embedding costs about
 * 23 ms of CPU. 384 floats each, so this is well under 1 MB.
 */
export const EMBED_CACHE_SIZE = 200;

/**
 * Generates sentence embeddings fully locally via @xenova/transformers
 * (Transformers.js) — no API key, no request quota, unlike a hosted
 * embeddings API. Trade-off: downloads the model (~90MB) from the Hugging
 * Face hub on first use, so the first embed() call needs internet access
 * (cached under node_modules/@xenova/transformers/.cache afterwards).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  /** Saved on every chunk (M2-14), so a model change can find old ones. */
  readonly modelName: string;
  private embedderPromise?: Promise<Embedder>;
  /** Insertion-ordered, so the first key is the least recently used. */
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly configService: ConfigService) {
    this.modelName =
      this.configService.get<string>('knowledge.embeddingModel') ??
      'Xenova/all-MiniLM-L6-v2';
  }

  async embed(text: string): Promise<number[]> {
    // Exact text only (trimmed, spaces collapsed): the vector is a pure
    // function of it, so a hit is identical to a fresh embedding. Nothing
    // here is tenant data: same text, same vector, for everyone.
    const key = text.trim().replace(/\s+/g, ' ');
    const cached = this.recent.get(key);
    if (cached) {
      this.recent.delete(key);
      this.recent.set(key, cached);
      return cached.slice();
    }
    const embedder = await this.getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);
    this.recent.set(key, vector);
    if (this.recent.size > EMBED_CACHE_SIZE) {
      this.recent.delete(this.recent.keys().next().value as string);
    }
    return vector.slice();
  }

  private getEmbedder(): Promise<Embedder> {
    if (!this.embedderPromise) {
      this.embedderPromise = this.loadEmbedder();
    }
    return this.embedderPromise;
  }

  private async loadEmbedder(): Promise<Embedder> {
    this.logger.log(`Loading local embedding model ${this.modelName}...`);
    // @xenova/transformers ships ESM-only; this app compiles to CommonJS,
    // so a static `import` would throw ERR_REQUIRE_ESM at runtime — dynamic
    // import() is the documented workaround for loading an ESM package
    // from CommonJS.
    const { pipeline } = await import('@xenova/transformers');
    const embedder = await pipeline('feature-extraction', this.modelName);
    return embedder as unknown as Embedder;
  }
}
