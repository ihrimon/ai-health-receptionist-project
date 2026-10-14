import type { PrismaService } from '../../database/prisma.service';
import type { IngestKind } from './knowledge-ingest.queue';

export interface ReembedItem {
  workspaceId: string;
  kind: IngestKind;
  id: string;
}

/**
 * Everything, in every workspace, that isn't embedded with `model` (M2-15):
 * - sources and FAQs whose chunks came from another model;
 * - custom answers and products embedded with another model, or never
 *   (saved before indexing existed, M2-13);
 * - FAQs with no chunks, and policy/text pages still QUEUED with none
 *   (saved before indexing existed, M2-11).
 * FAILED sources are left alone: their file fails the same way again.
 *
 * Reads across workspaces, so it uses the platform PrismaService; each
 * item keeps its own workspace, and its job runs inside that workspace.
 */
export async function findItemsToReembed(
  prisma: PrismaService,
  model: string,
): Promise<ReembedItem[]> {
  const otherOrNone = {
    OR: [{ embeddingModel: null }, { embeddingModel: { not: model } }],
  };
  const [staleChunks, unindexedFaqs, queuedSources, customAnswers, products] =
    await Promise.all([
      prisma.knowledgeChunk.findMany({
        where: { embeddingModel: { not: model } },
        select: { workspaceId: true, sourceId: true, faqId: true },
        distinct: ['sourceId', 'faqId'],
      }),
      prisma.faq.findMany({
        where: { chunks: { none: {} } },
        select: { workspaceId: true, id: true },
      }),
      prisma.knowledgeSource.findMany({
        where: { status: 'QUEUED', chunks: { none: {} } },
        select: { workspaceId: true, id: true },
      }),
      prisma.customAnswer.findMany({
        where: otherOrNone,
        select: { workspaceId: true, id: true },
      }),
      prisma.product.findMany({
        where: otherOrNone,
        select: { workspaceId: true, id: true },
      }),
    ]);

  const items = new Map<string, ReembedItem>();
  const add = (kind: IngestKind, workspaceId: string, id: string) =>
    items.set(`${kind}:${id}`, { workspaceId, kind, id });

  for (const chunk of staleChunks) {
    if (chunk.sourceId) add('source', chunk.workspaceId, chunk.sourceId);
    if (chunk.faqId) add('faq', chunk.workspaceId, chunk.faqId);
  }
  for (const faq of unindexedFaqs) add('faq', faq.workspaceId, faq.id);
  for (const s of queuedSources) add('source', s.workspaceId, s.id);
  for (const a of customAnswers) add('customAnswer', a.workspaceId, a.id);
  for (const p of products) add('product', p.workspaceId, p.id);
  return [...items.values()];
}

/** "3 source, 12 faq" for the script's report. */
export function summarize(items: ReembedItem[]): string {
  const counts = new Map<IngestKind, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${kind}`).join(', ') || 'nothing';
}
