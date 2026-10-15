import type { PrismaService } from '../../database/prisma.service';
import { findItemsToReembed, summarize } from './reembed';

describe('findItemsToReembed', () => {
  const findMany = () => jest.fn().mockResolvedValue([]);
  let prisma: Record<string, { findMany: jest.Mock }>;

  beforeEach(() => {
    prisma = {
      knowledgeChunk: { findMany: findMany() },
      faq: { findMany: findMany() },
      knowledgeSource: { findMany: findMany() },
      customAnswer: { findMany: findMany() },
      product: { findMany: findMany() },
    };
  });
  const run = () =>
    findItemsToReembed(prisma as unknown as PrismaService, 'new-model');

  it('finds chunks from another model by their source or FAQ, once each', async () => {
    prisma.knowledgeChunk.findMany.mockResolvedValue([
      { workspaceId: 'ws-1', sourceId: 'src-1', faqId: null },
      { workspaceId: 'ws-2', sourceId: null, faqId: 'faq-1' },
    ]);
    // The same FAQ also has no chunks of the new model: still one job.
    prisma.faq.findMany.mockResolvedValue([
      { workspaceId: 'ws-2', id: 'faq-1' },
    ]);

    await expect(run()).resolves.toEqual([
      { workspaceId: 'ws-1', kind: 'source', id: 'src-1' },
      { workspaceId: 'ws-2', kind: 'faq', id: 'faq-1' },
    ]);
    expect(prisma.knowledgeChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { embeddingModel: { not: 'new-model' } },
      }),
    );
  });

  it('catches up items never embedded, keeping each in its workspace', async () => {
    prisma.knowledgeSource.findMany.mockResolvedValue([
      { workspaceId: 'ws-1', id: 'src-9' },
    ]);
    prisma.customAnswer.findMany.mockResolvedValue([
      { workspaceId: 'ws-1', id: 'ca-1' },
    ]);
    prisma.product.findMany.mockResolvedValue([
      { workspaceId: 'ws-3', id: 'p-1' },
    ]);

    const items = await run();

    expect(items).toEqual([
      { workspaceId: 'ws-1', kind: 'source', id: 'src-9' },
      { workspaceId: 'ws-1', kind: 'customAnswer', id: 'ca-1' },
      { workspaceId: 'ws-3', kind: 'product', id: 'p-1' },
    ]);
    // Only QUEUED sources without chunks: FAILED ones would fail again.
    expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'QUEUED', chunks: { none: {} } },
      }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { embeddingModel: null },
            { embeddingModel: { not: 'new-model' } },
          ],
        },
      }),
    );
  });

  it('summarizes counts per kind', () => {
    expect(
      summarize([
        { workspaceId: 'w', kind: 'faq', id: '1' },
        { workspaceId: 'w', kind: 'faq', id: '2' },
        { workspaceId: 'w', kind: 'product', id: '3' },
      ]),
    ).toBe('2 faq, 1 product');
    expect(summarize([])).toBe('nothing');
  });
});
