import { Inject, Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { chunkText, type TextChunk } from './chunk-text';
import { EmbeddingService } from './embedding.service';
import { IngestError } from './ingest-error';
import type { IngestKind } from './knowledge-ingest.queue';
import { type EmbeddedChunk, KnowledgeService } from './knowledge.service';
import { extractDocumentText, type ExtractedPage } from './text-extract';

/** Shown for failures the company can't fix themselves. */
export const INGEST_FAILED_MESSAGE =
  'Something went wrong while indexing this source. Try again; if it keeps failing, contact support.';

/** What an FAQ is indexed as: the question gives the answer its meaning. */
export function faqText(faq: { question: string; answer: string }): string {
  return `${faq.question}\n\n${faq.answer}`;
}

/** What a product is embedded as (D-1): name, category, description. */
export function productText(product: {
  name: string;
  category: string | null;
  description: string | null;
}): string {
  return [product.name, product.category, product.description]
    .filter(Boolean)
    .join('\n');
}

/**
 * Makes knowledge searchable (M2-11, M2-13), in a background job inside
 * the item's workspace context:
 * - sources (policy/text pages, documents) and FAQs become chunks in
 *   `knowledge_chunks`; a source's status goes QUEUED → PROCESSING → READY
 *   (or FAILED);
 * - custom answers and products get an embedding on their own row.
 *
 * Every write first checks the item still holds the text that was
 * embedded: an edit meanwhile queued a newer job, which writes instead.
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

  ingest(kind: IngestKind, id: string): Promise<void> {
    switch (kind) {
      case 'source':
        return this.ingestSource(id);
      case 'faq':
        return this.ingestFaq(id);
      case 'customAnswer':
        return this.ingestCustomAnswer(id);
      case 'product':
        return this.ingestProduct(id);
    }
  }

  /**
   * Marks a source FAILED with a message for the dashboard. Other kinds
   * have no status to show; their failure is only logged.
   */
  async fail(kind: IngestKind, id: string, message: string): Promise<void> {
    if (kind !== 'source') return;
    // updateMany: the source may have been deleted meanwhile.
    await this.db.knowledgeSource.updateMany({
      where: { id },
      data: { status: 'FAILED', error: message },
    });
  }

  private async ingestSource(sourceId: string): Promise<void> {
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
    const embedded = await this.embedChunks(chunkText(pages, source.title));

    const written = await this.db.$transaction(async (tx) => {
      // Sources change only through edits and reindex, both of which queue
      // a job, so any update since PROCESSING means a newer job exists.
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
    this.logResult('source', sourceId, written, embedded.length);
  }

  private async ingestFaq(faqId: string): Promise<void> {
    const select = { chatbotId: true, question: true, answer: true } as const;
    const faq = await this.db.faq.findFirst({ where: { id: faqId }, select });
    if (!faq) return;

    const text = faqText(faq);
    const embedded = await this.embedChunks(
      chunkText([{ text }], faq.question),
    );
    // Text, not updatedAt: reordering FAQs updates rows without changing
    // what needs embedding.
    const written = await this.db.$transaction(async (tx) => {
      const current = await tx.faq.findFirst({ where: { id: faqId }, select });
      if (!current || faqText(current) !== text) return false;
      await this.knowledge.replaceFaqChunks(tx, faq.chatbotId, faqId, embedded);
      return true;
    });
    this.logResult('faq', faqId, written, embedded.length);
  }

  private async ingestCustomAnswer(id: string): Promise<void> {
    const select = { triggerQuestion: true } as const;
    const answer = await this.db.customAnswer.findFirst({
      where: { id },
      select,
    });
    if (!answer) return;

    const embedding = await this.embedding.embed(answer.triggerQuestion);
    const written = await this.db.$transaction(async (tx) => {
      const current = await tx.customAnswer.findFirst({
        where: { id },
        select,
      });
      if (current?.triggerQuestion !== answer.triggerQuestion) return false;
      await this.knowledge.setCustomAnswerEmbedding(tx, id, embedding);
      return true;
    });
    this.logResult('customAnswer', id, written, 1);
  }

  private async ingestProduct(id: string): Promise<void> {
    const select = { name: true, category: true, description: true } as const;
    const product = await this.db.product.findFirst({
      where: { id },
      select,
    });
    if (!product) return;

    const text = productText(product);
    const embedding = await this.embedding.embed(text);
    const written = await this.db.$transaction(async (tx) => {
      const current = await tx.product.findFirst({ where: { id }, select });
      if (!current || productText(current) !== text) return false;
      await this.knowledge.setProductEmbedding(tx, id, embedding);
      return true;
    });
    this.logResult('product', id, written, 1);
  }

  private async embedChunks(chunks: TextChunk[]): Promise<EmbeddedChunk[]> {
    if (chunks.length === 0) {
      throw new IngestError('There is no text to index.');
    }
    const embedded: EmbeddedChunk[] = [];
    for (const chunk of chunks) {
      embedded.push({
        ...chunk,
        embedding: await this.embedding.embed(chunk.content),
      });
    }
    return embedded;
  }

  private logResult(
    kind: IngestKind,
    id: string,
    written: boolean,
    count: number,
  ): void {
    this.logger.log(
      written
        ? `Indexed ${kind} ${id}: ${count} embedding(s)`
        : `${kind} ${id} changed while indexing; left to the newer job`,
    );
  }
}
