import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface KnowledgeChunkInput {
  source: string;
  content: string;
}

export interface KnowledgeMatch {
  source: string;
  content: string;
  similarity: number;
}

/**
 * `knowledge_chunks.embedding` is a pgvector column, declared as
 * `Unsupported("vector(384)")` in prisma/schema.prisma — Prisma Client can't
 * read or write it, so every query that touches it is raw SQL here, via
 * Prisma's tagged-template `$queryRaw`/`$executeRaw` (values are sent as
 * bound parameters, never interpolated into the SQL text). Keep raw SQL for
 * this table inside this service. Raw queries also bypass any automatic
 * tenant filtering added later (M1-24), so tenant conditions must be
 * written here by hand (docs/design/d1-data-model.md §5).
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly topK: number;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.topK = this.configService.get<number>('knowledge.topK') ?? 3;
  }

  /**
   * Replaces the entire knowledge base with the given chunks. Simple
   * full-replace re-ingestion is fine at FAQ-doc scale (tens of chunks);
   * revisit if the knowledge base grows large enough that re-embedding
   * everything on every edit becomes slow.
   */
  async replaceAll(chunks: KnowledgeChunkInput[]): Promise<void> {
    // Embed first, so a failing embedding doesn't leave the table emptied.
    const rows: (KnowledgeChunkInput & { vector: string })[] = [];
    for (const chunk of chunks) {
      const embedding = await this.embeddingService.embed(chunk.content);
      rows.push({ ...chunk, vector: toVectorLiteral(embedding) });
    }

    await this.prisma.$transaction([
      this.prisma.$executeRaw`DELETE FROM knowledge_chunks`,
      ...rows.map(
        (row) =>
          this.prisma
            .$executeRaw`INSERT INTO knowledge_chunks (source, content, embedding) VALUES (${row.source}, ${row.content}, ${row.vector}::vector)`,
      ),
    ]);

    this.logger.log(`Ingested ${chunks.length} knowledge chunk(s).`);
  }

  async search(query: string, topK = this.topK): Promise<KnowledgeMatch[]> {
    const vector = toVectorLiteral(await this.embeddingService.embed(query));
    return this.prisma.$queryRaw<KnowledgeMatch[]>`
      SELECT source, content, 1 - (embedding <=> ${vector}::vector) AS similarity
      FROM knowledge_chunks
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${topK}`;
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
