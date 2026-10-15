import { Test } from '@nestjs/testing';
import { StorageService } from '../../storage/storage.service';
import { requireTenant, runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { EmbeddingService } from './embedding.service';
import { IngestError } from './ingest-error';
import { ConfigService } from '@nestjs/config';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';
import {
  type IngestJob,
  KnowledgeIngestProcessor,
} from './knowledge-ingest.processor';
import {
  INGEST_FAILED_MESSAGE,
  KnowledgeIngestService,
} from './knowledge-ingest.service';
import { KnowledgeService } from './knowledge.service';

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'system', role: 'OWNER' }, fn);

const STARTED = new Date('2026-10-14T10:00:00Z');

describe('KnowledgeIngestService', () => {
  let service: KnowledgeIngestService;
  let knowledgeSource: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  let storage: { get: jest.Mock };
  let replaceSourceChunks: jest.Mock;

  const policy = {
    chatbotId: 'bot-1',
    type: 'POLICY',
    title: 'Returns',
    content: '## Returns\n\nWithin 30 days.',
    fileKey: null,
    mimeType: null,
  };

  beforeEach(async () => {
    knowledgeSource = {
      // First call: the source; second (in the transaction): updatedAt.
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(policy)
        .mockResolvedValueOnce({ updatedAt: STARTED }),
      update: jest.fn().mockResolvedValue({ updatedAt: STARTED }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    storage = { get: jest.fn() };
    replaceSourceChunks = jest.fn().mockResolvedValue(undefined);
    const db = {
      knowledgeSource,
      $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
        fn({ knowledgeSource }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeIngestService,
        { provide: TENANT_PRISMA, useValue: db },
        { provide: StorageService, useValue: storage },
        {
          provide: EmbeddingService,
          useValue: { embed: jest.fn().mockResolvedValue([0.1]) },
        },
        { provide: KnowledgeService, useValue: { replaceSourceChunks } },
      ],
    }).compile();
    service = module.get(KnowledgeIngestService);
  });

  it('indexes a policy page and marks it READY', async () => {
    await inTenant(() => service.ingest('source', 'src-1'));

    expect(knowledgeSource.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'src-1' },
      data: { status: 'PROCESSING', error: null },
      select: { updatedAt: true },
    });
    expect(replaceSourceChunks).toHaveBeenCalledWith(
      expect.anything(),
      'bot-1',
      'src-1',
      [
        {
          content: 'Returns\nWithin 30 days.',
          metadata: { title: 'Returns', headingPath: ['Returns'] },
          embedding: [0.1],
        },
      ],
    );
    expect(knowledgeSource.update).toHaveBeenLastCalledWith({
      where: { id: 'src-1' },
      data: { status: 'READY', error: null },
    });
  });

  it("reads a document's file and keeps its extracted text", async () => {
    knowledgeSource.findFirst.mockReset();
    knowledgeSource.findFirst
      .mockResolvedValueOnce({
        ...policy,
        type: 'DOCUMENT',
        content: null,
        fileKey: 'workspaces/ws-1/documents/u/faq.txt',
        mimeType: 'text/plain',
      })
      .mockResolvedValueOnce({ updatedAt: STARTED });
    storage.get.mockResolvedValue(Buffer.from('Open 9 to 5.'));

    await inTenant(() => service.ingest('source', 'src-1'));

    expect(storage.get).toHaveBeenCalledWith(
      'workspaces/ws-1/documents/u/faq.txt',
    );
    expect(knowledgeSource.update).toHaveBeenLastCalledWith({
      where: { id: 'src-1' },
      data: { status: 'READY', error: null, content: 'Open 9 to 5.' },
    });
  });

  it('writes nothing when the source changed while it was indexed', async () => {
    knowledgeSource.findFirst.mockReset();
    knowledgeSource.findFirst
      .mockResolvedValueOnce(policy)
      .mockResolvedValueOnce({ updatedAt: new Date('2026-10-14T10:00:05Z') });

    await inTenant(() => service.ingest('source', 'src-1'));

    expect(replaceSourceChunks).not.toHaveBeenCalled();
    expect(knowledgeSource.update).toHaveBeenCalledTimes(1); // PROCESSING only
  });

  it('does nothing for a source deleted since it was queued', async () => {
    knowledgeSource.findFirst.mockReset();
    knowledgeSource.findFirst.mockResolvedValue(null);

    await inTenant(() => service.ingest('source', 'src-1'));

    expect(knowledgeSource.update).not.toHaveBeenCalled();
  });

  it('is an IngestError when there is no text', async () => {
    knowledgeSource.findFirst.mockReset();
    knowledgeSource.findFirst.mockResolvedValueOnce({
      ...policy,
      content: '  ',
    });

    await expect(
      inTenant(() => service.ingest('source', 'src-1')),
    ).rejects.toThrow(IngestError);
  });
});

describe('KnowledgeIngestProcessor', () => {
  let processor: KnowledgeIngestProcessor;
  let ingest: { ingest: jest.Mock; fail: jest.Mock };
  let boss: { work: jest.Mock };

  /** A pg-boss job on its first attempt (retryCount 0) or a retry. */
  const job = (retryCount: number): IngestJob => ({
    data: { workspaceId: 'ws-1', kind: 'source', id: 'src-1' },
    retryCount,
  });

  beforeEach(async () => {
    ingest = {
      ingest: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    boss = { work: jest.fn().mockResolvedValue('worker-1') };
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeIngestProcessor,
        { provide: KnowledgeIngestService, useValue: ingest },
        { provide: PG_BOSS, useValue: boss },
        { provide: ConfigService, useValue: { get: () => 1 } },
      ],
    }).compile();
    processor = module.get(KnowledgeIngestProcessor);
  });

  it('works the knowledge-ingest queue one job at a time', async () => {
    await processor.onApplicationBootstrap();

    expect(boss.work).toHaveBeenCalledWith(
      QUEUE_NAMES.KNOWLEDGE_INGEST,
      { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 1 },
      expect.any(Function),
    );
    // The handler processes each job of the batch it gets.
    const handler = (boss.work.mock.calls[0] as unknown[])[2] as (
      jobs: IngestJob[],
    ) => Promise<void>;
    await handler([job(0)]);
    expect(ingest.ingest).toHaveBeenCalledWith('source', 'src-1');
  });

  it("runs the job in the source's workspace", async () => {
    let workspace: string | undefined;
    ingest.ingest.mockImplementation(() => {
      workspace = requireTenant().workspaceId;
      return Promise.resolve();
    });

    await processor.process(job(0));

    expect(workspace).toBe('ws-1');
  });

  it('fails an unreadable source at once, without a retry', async () => {
    ingest.ingest.mockRejectedValue(new IngestError('No readable text found.'));

    await expect(processor.process(job(0))).resolves.toBeUndefined();
    expect(ingest.fail).toHaveBeenCalledWith(
      'source',
      'src-1',
      'No readable text found.',
    );
  });

  it('retries other errors, and marks FAILED only on the last attempt', async () => {
    ingest.ingest.mockRejectedValue(new Error('storage down'));

    await expect(processor.process(job(0))).rejects.toThrow('storage down');
    expect(ingest.fail).not.toHaveBeenCalled();

    await expect(processor.process(job(2))).rejects.toThrow('storage down');
    expect(ingest.fail).toHaveBeenCalledWith(
      'source',
      'src-1',
      INGEST_FAILED_MESSAGE,
    );
  });
});

describe('KnowledgeIngestService (FAQs, custom answers, products)', () => {
  let service: KnowledgeIngestService;
  let embed: jest.Mock;
  let knowledge: {
    replaceFaqChunks: jest.Mock;
    setCustomAnswerEmbedding: jest.Mock;
    setProductEmbedding: jest.Mock;
  };
  const model = () => ({ findFirst: jest.fn() });
  let faq: ReturnType<typeof model>;
  let customAnswer: ReturnType<typeof model>;
  let product: ReturnType<typeof model>;

  beforeEach(async () => {
    faq = model();
    customAnswer = model();
    product = model();
    embed = jest.fn().mockResolvedValue([0.3]);
    knowledge = {
      replaceFaqChunks: jest.fn(),
      setCustomAnswerEmbedding: jest.fn(),
      setProductEmbedding: jest.fn(),
    };
    const db = {
      faq,
      customAnswer,
      product,
      $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
        fn({ faq, customAnswer, product }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeIngestService,
        { provide: TENANT_PRISMA, useValue: db },
        { provide: StorageService, useValue: {} },
        { provide: EmbeddingService, useValue: { embed } },
        { provide: KnowledgeService, useValue: knowledge },
      ],
    }).compile();
    service = module.get(KnowledgeIngestService);
  });

  it('indexes an FAQ as its question and answer together', async () => {
    const row = {
      chatbotId: 'bot-1',
      question: 'Do you ship?',
      answer: 'Yes.',
    };
    faq.findFirst.mockResolvedValue(row);

    await inTenant(() => service.ingest('faq', 'faq-1'));

    expect(knowledge.replaceFaqChunks).toHaveBeenCalledWith(
      expect.anything(),
      'bot-1',
      'faq-1',
      [
        {
          content: 'Do you ship?\n\nYes.',
          metadata: { title: 'Do you ship?', headingPath: [] },
          embedding: [0.3],
        },
      ],
    );
  });

  it("embeds a custom answer's trigger question", async () => {
    customAnswer.findFirst.mockResolvedValue({
      triggerQuestion: 'Who owns it?',
    });

    await inTenant(() => service.ingest('customAnswer', 'ca-1'));

    expect(embed).toHaveBeenCalledWith('Who owns it?');
    expect(knowledge.setCustomAnswerEmbedding).toHaveBeenCalledWith(
      expect.anything(),
      'ca-1',
      [0.3],
    );
  });

  it("embeds a product's name, category and description", async () => {
    product.findFirst.mockResolvedValue({
      name: 'Trail shoe',
      category: 'Footwear',
      description: null,
    });

    await inTenant(() => service.ingest('product', 'p-1'));

    expect(embed).toHaveBeenCalledWith('Trail shoe\nFootwear');
    expect(knowledge.setProductEmbedding).toHaveBeenCalledWith(
      expect.anything(),
      'p-1',
      [0.3],
    );
  });

  it('writes nothing when the text changed while it was embedded', async () => {
    product.findFirst
      .mockResolvedValueOnce({ name: 'Old', category: null, description: null })
      .mockResolvedValueOnce({
        name: 'New',
        category: null,
        description: null,
      });

    await inTenant(() => service.ingest('product', 'p-1'));

    expect(knowledge.setProductEmbedding).not.toHaveBeenCalled();
  });

  it('does nothing for an item deleted since it was queued', async () => {
    faq.findFirst.mockResolvedValue(null);

    await inTenant(() => service.ingest('faq', 'faq-1'));

    expect(embed).not.toHaveBeenCalled();
  });

  it('only sources have a FAILED status to set', async () => {
    await expect(
      inTenant(() => service.fail('product', 'p-1', 'x')),
    ).resolves.toBeUndefined();
  });
});
