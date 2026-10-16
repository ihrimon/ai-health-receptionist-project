import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import type { ChunkMetadata } from './chunk-text';
import { EmbeddingService } from './embedding.service';
import { keywordQuery } from './keyword-query';

/** Reciprocal Rank Fusion constant: how fast a lower rank stops counting (M3-7). */
const RRF_K = 60;
/** Candidates taken from each of the two searches before they are merged. */
const MIN_CANDIDATES = 20;

/** A transaction on the tenant client, as `$transaction(async (tx) => …)` gives it. */
export type TenantTx = Parameters<
  Parameters<TenantPrisma['$transaction']>[0]
>[0];

export interface EmbeddedChunk {
  content: string;
  metadata: ChunkMetadata;
  embedding: number[];
}

export interface KnowledgeMatch {
  content: string;
  metadata: ChunkMetadata;
  similarity: number;
  /** The chunk contains a word of the question (keyword search). */
  keywordHit: boolean;
}

/** A product as the chat tools see it (M3-8). Money is text, never a float. */
export interface ProductHit {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  compareAtPrice: string | null;
  currency: string;
  stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'PREORDER' | 'UNKNOWN';
  category: string | null;
  url: string | null;
  attributes: unknown;
}

export interface ProductFilter {
  query: string;
  category?: string;
  maxPrice?: number;
  inStockOnly?: boolean;
}

/** A custom answer whose trigger question is close to the visitor's. */
export interface CustomAnswerMatch {
  id: string;
  triggerQuestion: string;
  answer: string;
  similarity: number;
}

/**
 * A chunk is worth giving to the model when it shares a word with the
 * question or is close enough in meaning (M3-10). Exported for tests.
 */
export function isRelevant(
  match: Pick<KnowledgeMatch, 'keywordHit' | 'similarity'>,
  minSimilarity: number,
): boolean {
  return match.keywordHit || Number(match.similarity) >= minSimilarity;
}

/**
 * Reads and writes `knowledge_chunks` (M2-12). `embedding` is a pgvector
 * column Prisma Client can't handle, so these queries are raw SQL: tagged
 * templates (values become bound parameters, never SQL text), kept in this
 * one file (raw-sql-confinement.spec.ts). Raw SQL bypasses the tenant
 * client's automatic filter, so every query here adds
 * `workspace_id = <current workspace>` itself.
 */
@Injectable()
export class KnowledgeService {
  private readonly topK: number;
  private readonly minSimilarity: number;
  private readonly customAnswerThreshold: number;

  constructor(
    private readonly embedding: EmbeddingService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    config: ConfigService,
  ) {
    this.topK = config.get<number>('knowledge.topK') ?? 3;
    this.minSimilarity = config.get<number>('knowledge.minSimilarity') ?? 0.3;
    this.customAnswerThreshold =
      config.get<number>('knowledge.customAnswerThreshold') ?? 0.8;
  }

  /**
   * Replaces a source's chunks with new ones, inside the caller's
   * transaction so the swap and the source's status change land together.
   */
  async replaceSourceChunks(
    tx: TenantTx,
    chatbotId: string,
    sourceId: string,
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    const { workspaceId } = requireTenant();
    await tx.$executeRaw`
      DELETE FROM knowledge_chunks
      WHERE source_id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid`;
    await this.insertChunks(tx, chatbotId, { sourceId }, chunks);
  }

  /** Replaces an FAQ's chunks (M2-13), like replaceSourceChunks. */
  async replaceFaqChunks(
    tx: TenantTx,
    chatbotId: string,
    faqId: string,
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    const { workspaceId } = requireTenant();
    await tx.$executeRaw`
      DELETE FROM knowledge_chunks
      WHERE faq_id = ${faqId}::uuid AND workspace_id = ${workspaceId}::uuid`;
    await this.insertChunks(tx, chatbotId, { faqId }, chunks);
  }

  /** Stores a custom answer's trigger-question embedding (M2-13). */
  async setCustomAnswerEmbedding(
    tx: TenantTx,
    id: string,
    embedding: number[],
  ): Promise<void> {
    const { workspaceId } = requireTenant();
    // Raw SQL leaves updated_at alone, so this doesn't look like an edit.
    await tx.$executeRaw`
      UPDATE custom_answers
      SET embedding = ${toVectorLiteral(embedding)}::vector,
          embedding_model = ${this.embedding.modelName}
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  }

  /** Stores a product's embedding (name + category + description, M2-13). */
  async setProductEmbedding(
    tx: TenantTx,
    id: string,
    embedding: number[],
  ): Promise<void> {
    const { workspaceId } = requireTenant();
    await tx.$executeRaw`
      UPDATE products
      SET embedding = ${toVectorLiteral(embedding)}::vector,
          embedding_model = ${this.embedding.modelName}
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  }

  private async insertChunks(
    tx: TenantTx,
    chatbotId: string,
    owner: { sourceId?: string; faqId?: string },
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    const { workspaceId } = requireTenant();
    const model = this.embedding.modelName;
    const sourceId = owner.sourceId ?? null;
    const faqId = owner.faqId ?? null;
    for (const [index, chunk] of chunks.entries()) {
      await tx.$executeRaw`
        INSERT INTO knowledge_chunks
          (workspace_id, chatbot_id, source_id, faq_id, chunk_index, content, metadata, embedding, embedding_model)
        VALUES (
          ${workspaceId}::uuid, ${chatbotId}::uuid, ${sourceId}::uuid, ${faqId}::uuid, ${index},
          ${chunk.content}, ${JSON.stringify(chunk.metadata)}::jsonb,
          ${toVectorLiteral(chunk.embedding)}::vector, ${model}
        )`;
    }
  }

  /**
   * The active products of one chatbot that best match `filter` (M3-8):
   * the same meaning + keyword search as the knowledge chunks, merged by
   * rank, after the structured filters. Raw SQL, so the workspace is added
   * by hand.
   */
  async searchProducts(
    chatbotId: string,
    filter: ProductFilter,
    limit: number,
  ): Promise<ProductHit[]> {
    const { workspaceId } = requireTenant();
    const vector = toVectorLiteral(await this.embedding.embed(filter.query));
    const keywords = keywordQuery(filter.query);
    const category = filter.category ?? null;
    const maxPrice = filter.maxPrice ?? null;
    const inStockOnly = filter.inStockOnly ?? false;
    const candidates = Math.max(limit * 4, MIN_CANDIDATES);

    const rows = await this.db.$queryRaw<
      (Omit<ProductHit, 'price' | 'compareAtPrice'> & {
        price: string | null;
        compareAtPrice: string | null;
      })[]
    >`
      WITH eligible AS (
        SELECT * FROM products
        WHERE workspace_id = ${workspaceId}::uuid AND chatbot_id = ${chatbotId}::uuid
          AND is_active
          AND (${category}::text IS NULL OR lower(category) = lower(${category}::text))
          AND (${maxPrice}::numeric IS NULL OR price <= ${maxPrice}::numeric)
          AND (NOT ${inStockOnly}::boolean OR stock_status <> 'OUT_OF_STOCK')
      ),
      meaning AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vector}::vector) AS rank
        FROM eligible
        WHERE embedding IS NOT NULL AND embedding_model = ${this.embedding.modelName}
        ORDER BY embedding <=> ${vector}::vector
        LIMIT ${candidates}
      ),
      keyword AS (
        SELECT e.id, ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', e.name || ' ' || coalesce(e.category, '') || ' ' || coalesce(e.description, '')),
            q.query) DESC
        ) AS rank
        FROM eligible e,
             to_tsquery('english', ${keywords ?? ''}::text) AS q(query)
        WHERE to_tsvector('english', e.name || ' ' || coalesce(e.category, '') || ' ' || coalesce(e.description, '')) @@ q.query
        LIMIT ${candidates}
      ),
      fused AS (
        SELECT id, SUM(1.0 / (${RRF_K}::int + rank)) AS score
        FROM (SELECT id, rank FROM meaning UNION ALL SELECT id, rank FROM keyword) ranked
        GROUP BY id
      )
      SELECT p.id::text AS id, p.name, p.description, p.price::text AS price,
             p.compare_at_price::text AS "compareAtPrice", p.currency,
             p.stock_status::text AS "stockStatus", p.category, p.url, p.attributes
      FROM fused f
      JOIN products p ON p.id = f.id
      WHERE p.workspace_id = ${workspaceId}::uuid AND p.chatbot_id = ${chatbotId}::uuid
      ORDER BY f.score DESC, p.id
      LIMIT ${limit}`;
    return rows;
  }

  /** One active product of this chatbot, or null. */
  async getProduct(
    chatbotId: string,
    productId: string,
  ): Promise<ProductHit | null> {
    const row = await this.db.product.findFirst({
      where: { id: productId, chatbotId, isActive: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price === null ? null : row.price.toFixed(2),
      compareAtPrice:
        row.compareAtPrice === null ? null : row.compareAtPrice.toFixed(2),
      currency: row.currency,
      stockStatus: row.stockStatus,
      category: row.category,
      url: row.url,
      attributes: row.attributes,
    };
  }

  /** The question as a vector, to share between searches. */
  embedQuery(query: string): Promise<number[]> {
    return this.embedding.embed(query);
  }

  /**
   * The active custom answer whose trigger question is closest to
   * `query`, if it is close enough to answer as written (M3-6). Only
   * answers embedded with the current model are compared, so a model
   * change can't make old vectors match by accident. Raw SQL, so the
   * workspace is added by hand.
   */
  async matchCustomAnswer(
    chatbotId: string,
    query: string,
    vector?: number[],
  ): Promise<CustomAnswerMatch | null> {
    const { workspaceId } = requireTenant();
    const literal = toVectorLiteral(
      vector ?? (await this.embedding.embed(query)),
    );
    const rows = await this.db.$queryRaw<CustomAnswerMatch[]>`
      SELECT id::text AS id, trigger_question AS "triggerQuestion", answer,
             1 - (embedding <=> ${literal}::vector) AS similarity
      FROM custom_answers
      WHERE workspace_id = ${workspaceId}::uuid AND chatbot_id = ${chatbotId}::uuid
        AND is_active AND embedding IS NOT NULL
        AND embedding_model = ${this.embedding.modelName}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT 1`;
    const best = rows[0];
    return best && Number(best.similarity) >= this.customAnswerThreshold
      ? { ...best, similarity: Number(best.similarity) }
      : null;
  }

  /**
   * The chunks of one chatbot that best answer `query` (M3-7): a meaning
   * search (pgvector) and a keyword search (Postgres full-text) run
   * side by side and are merged by rank (RRF), so an exact model number or
   * name is found even when the meaning search misses it. `similarity` is
   * always the cosine similarity, for display. Chunks that neither share
   * a word with the question nor are close in meaning are dropped, so an
   * empty result means "nothing relevant" (M3-10); pass
   * `onlyRelevant = false` to see them all. Only the current workspace's
   * chunks: raw SQL, so the workspace is added by hand.
   */
  async search(
    chatbotId: string,
    query: string,
    topK = this.topK,
    onlyRelevant = true,
    queryVector?: number[],
  ): Promise<KnowledgeMatch[]> {
    const { workspaceId } = requireTenant();
    const vector = toVectorLiteral(
      queryVector ?? (await this.embedding.embed(query)),
    );
    const keywords = keywordQuery(query);
    const candidates = Math.max(topK * 4, MIN_CANDIDATES);

    const rows = await this.db.$queryRaw<KnowledgeMatch[]>`
      WITH meaning AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vector}::vector) AS rank
        FROM knowledge_chunks
        WHERE workspace_id = ${workspaceId}::uuid AND chatbot_id = ${chatbotId}::uuid
        ORDER BY embedding <=> ${vector}::vector
        LIMIT ${candidates}
      ),
      keyword AS (
        SELECT c.id, ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(to_tsvector('english', c.content), q.query) DESC
        ) AS rank
        FROM knowledge_chunks c,
             to_tsquery('english', ${keywords ?? ''}::text) AS q(query)
        WHERE ${keywords !== null}
          AND c.workspace_id = ${workspaceId}::uuid AND c.chatbot_id = ${chatbotId}::uuid
          AND to_tsvector('english', c.content) @@ q.query
        ORDER BY ts_rank_cd(to_tsvector('english', c.content), q.query) DESC
        LIMIT ${candidates}
      ),
      fused AS (
        SELECT id, SUM(1.0 / (${RRF_K}::int + rank)) AS score
        FROM (SELECT id, rank FROM meaning UNION ALL SELECT id, rank FROM keyword) ranked
        GROUP BY id
      )
      SELECT c.content, c.metadata, 1 - (c.embedding <=> ${vector}::vector) AS similarity,
             EXISTS (SELECT 1 FROM keyword k WHERE k.id = c.id) AS "keywordHit"
      FROM fused f
      JOIN knowledge_chunks c ON c.id = f.id
      WHERE c.workspace_id = ${workspaceId}::uuid AND c.chatbot_id = ${chatbotId}::uuid
      ORDER BY f.score DESC, c.id
      LIMIT ${topK}`;
    return onlyRelevant
      ? rows.filter((row) => isRelevant(row, this.minSimilarity))
      : rows;
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
