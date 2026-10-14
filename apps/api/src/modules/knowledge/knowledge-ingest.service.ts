import { Inject, Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { chunkText } from './chunk-text';
import { EmbeddingService } from './embedding.service';
import { IngestError } from './ingest-error';
import { type EmbeddedChunk, KnowledgeService } from './knowledge.service';
import { extractDocumentText, type ExtractedPage } from './text-extract';

/** Shown for failures the company can't fix themselves. */
export const INGEST_FAILED_MESSAGE =
  'Something went wrong while indexing this source. Try again; if it keeps failing, contact support.';

/**
 * Turns one knowledge source into searchable chunks (M2-11): text →
 * chunks → embeddings → `knowledge_chunks`, with the source's status going
 * QUEUED → PROCESSING → READY (or FAILED). Runs in a background job inside
 * the source's workspace context.
 */
@Injectable()
export class KnowledgeIngestService {
  private readonly logger = new Logger(KnowledgeIngestService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly storage: StorageService,
    private readonly embedding: EmbeddingService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async ingest(sourceId: string): Promise<void> {
    const source = await this.db.knowledgeSource.findFirst({
      where: { id: sourceId },
      select: {
        chatbotId: true,
        type: true,
        title: true,
        content: true,
        fileKey: true,
        mimeType: true,
      },
    });
    if (!source) return; // Deleted since it was queued.

    const started = await this.db.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'PROCESSING', error: null },
      select: { updatedAt: true },
    });

    const pages: ExtractedPage[] =
      source.type === 'DOCUMENT'
        ? await extractDocumentText(
            await this.storage.get(source.fileKey!),
            source.mimeType!,
          )
        : [{ text: source.content ?? '' }];
    const chunks = chunkText(pages, source.title);
    if (chunks.length === 0)
      throw new IngestError('There is no text to index.');

    const embedded: EmbeddedChunk[] = [];
    for (const chunk of chunks) {
      embedded.push({
        ...chunk,
        embedding: await this.embedding.embed(chunk.content),
      });
    }

    const written = await this.db.$transaction(async (tx) => {
      // An edit while this job ran queued a newer job; let that one write.
      const current = await tx.knowledgeSource.findFirst({
        where: { id: sourceId },
        select: { updatedAt: true },
      });
      if (current?.updatedAt.getTime() !== started.updatedAt.getTime()) {
        return false;
      }
      await this.knowledge.replaceSourceChunks(
        tx,
        source.chatbotId,
        sourceId,
        embedded,
      );
      await tx.knowledgeSource.update({
        where: { id: sourceId },
        data: {
          status: 'READY',
          error: null,
          // A document's extracted text, for the dashboard (D-1).
          ...(source.type === 'DOCUMENT' && {
            content: pages.map((p) => p.text).join('\n\n'),
          }),
        },
      });
      return true;
    });
    this.logger.log(
      written
        ? `Indexed source ${sourceId}: ${embedded.length} chunk(s)`
        : `Source ${sourceId} changed while indexing; left to the newer job`,
    );
  }

  /** Marks a source FAILED with a message for the dashboard. */
  async fail(sourceId: string, message: string): Promise<void> {
    // updateMany: the source may have been deleted meanwhile.
    await this.db.knowledgeSource.updateMany({
      where: { id: sourceId },
      data: { status: 'FAILED', error: message },
    });
  }
}
