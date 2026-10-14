import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import type { ChunkMetadata } from './chunk-text';
import { EmbeddingService } from './embedding.service';

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

  constructor(
    private readonly embedding: EmbeddingService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    config: ConfigService,
  ) {
    this.topK = config.get<number>('knowledge.topK') ?? 3;
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
    const model = this.embedding.modelName;
    await tx.$executeRaw`
      DELETE FROM knowledge_chunks
      WHERE source_id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid`;
    for (const [index, chunk] of chunks.entries()) {
      await tx.$executeRaw`
        INSERT INTO knowledge_chunks
          (workspace_id, chatbot_id, source_id, chunk_index, content, metadata, embedding, embedding_model)
        VALUES (
          ${workspaceId}::uuid, ${chatbotId}::uuid, ${sourceId}::uuid, ${index},
          ${chunk.content}, ${JSON.stringify(chunk.metadata)}::jsonb,
          ${toVectorLiteral(chunk.embedding)}::vector, ${model}
        )`;
    }
  }

  /**
   * The chunks of one chatbot closest in meaning to `query` (M3 adds
   * keyword search on top). Only the current workspace's chunks.
   */
  async search(
    chatbotId: string,
    query: string,
    topK = this.topK,
  ): Promise<KnowledgeMatch[]> {
    const { workspaceId } = requireTenant();
    const vector = toVectorLiteral(await this.embedding.embed(query));
    return this.db.$queryRaw<KnowledgeMatch[]>`
      SELECT content, metadata, 1 - (embedding <=> ${vector}::vector) AS similarity
      FROM knowledge_chunks
      WHERE workspace_id = ${workspaceId}::uuid AND chatbot_id = ${chatbotId}::uuid
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${topK}`;
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
