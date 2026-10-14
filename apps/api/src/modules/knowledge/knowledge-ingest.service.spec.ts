import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { StorageService } from '../../storage/storage.service';
import { requireTenant, runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { EmbeddingService } from './embedding.service';
import { IngestError } from './ingest-error';
import { KnowledgeIngestProcessor } from './knowledge-ingest.processor';
import type { IngestJobData } from './knowledge-ingest.queue';
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
    await inTenant(() => service.ingest('src-1'));

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

    await inTenant(() => service.ingest('src-1'));

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

    await inTenant(() => service.ingest('src-1'));

    expect(replaceSourceChunks).not.toHaveBeenCalled();
    expect(knowledgeSource.update).toHaveBeenCalledTimes(1); // PROCESSING only
  });

  it('does nothing for a source deleted since it was queued', async () => {
    knowledgeSource.findFirst.mockReset();
    knowledgeSource.findFirst.mockResolvedValue(null);

    await inTenant(() => service.ingest('src-1'));

    expect(knowledgeSource.update).not.toHaveBeenCalled();
  });

  it('is an IngestError when there is no text', async () => {
    knowledgeSource.findFirst.mockReset();
    knowledgeSource.findFirst.mockResolvedValueOnce({
      ...policy,
      content: '  ',
    });

    await expect(inTenant(() => service.ingest('src-1'))).rejects.toThrow(
      IngestError,
    );
  });
});

describe('KnowledgeIngestProcessor', () => {
  let processor: KnowledgeIngestProcessor;
  let ingest: { ingest: jest.Mock; fail: jest.Mock };

  const job = (attemptsMade: number) =>
    ({
      data: { workspaceId: 'ws-1', sourceId: 'src-1' },
      attemptsMade,
      opts: { attempts: 3 },
    }) as unknown as Job<IngestJobData>;

  beforeEach(async () => {
    ingest = {
      ingest: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeIngestProcessor,
        { provide: KnowledgeIngestService, useValue: ingest },
      ],
    }).compile();
    processor = module.get(KnowledgeIngestProcessor);
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
      'src-1',
      'No readable text found.',
    );
  });

  it('retries other errors, and marks FAILED only on the last attempt', async () => {
    ingest.ingest.mockRejectedValue(new Error('storage down'));

    await expect(processor.process(job(0))).rejects.toThrow('storage down');
    expect(ingest.fail).not.toHaveBeenCalled();

    await expect(processor.process(job(2))).rejects.toThrow('storage down');
    expect(ingest.fail).toHaveBeenCalledWith('src-1', INGEST_FAILED_MESSAGE);
  });
});
