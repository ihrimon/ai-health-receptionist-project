import { KNOWLEDGE_LIMITS } from '@brainstack/shared';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { StorageService } from '../../storage/storage.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { KnowledgeIngestQueue } from '../knowledge/knowledge-ingest.queue';
import { CustomAnswersService } from './custom-answers.service';
import { KnowledgeSourcesService } from './knowledge-sources.service';

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'user-1', role: 'ADMIN' }, fn);

const page = { type: 'POLICY' as const, title: 'Returns', content: '30 days' };

describe('KnowledgeSourcesService and CustomAnswersService', () => {
  let sources: KnowledgeSourcesService;
  let customAnswers: CustomAnswersService;
  const mockModel = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(({ data }: { data: object }) => Promise.resolve(data)),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  });
  let knowledgeSource: ReturnType<typeof mockModel>;
  let customAnswer: ReturnType<typeof mockModel>;
  let storage: { put: jest.Mock; delete: jest.Mock };
  let ingestQueue: { enqueue: jest.Mock };

  beforeEach(async () => {
    knowledgeSource = mockModel();
    customAnswer = mockModel();
    ingestQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    storage = {
      put: jest
        .fn()
        .mockResolvedValue('workspaces/ws-1/documents/u/manual.pdf'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeSourcesService,
        CustomAnswersService,
        { provide: TENANT_PRISMA, useValue: { knowledgeSource, customAnswer } },
        {
          provide: ChatbotService,
          useValue: { currentId: () => Promise.resolve('bot-1') },
        },
        { provide: StorageService, useValue: storage },
        { provide: KnowledgeIngestQueue, useValue: ingestQueue },
      ],
    }).compile();
    sources = module.get(KnowledgeSourcesService);
    customAnswers = module.get(CustomAnswersService);
  });

  describe('knowledge sources', () => {
    it('lists without content, optionally by type', async () => {
      await sources.list('POLICY');

      const [[args]] = knowledgeSource.findMany.mock.calls as [
        [{ where: object; select: Record<string, boolean> }],
      ];
      expect(args.where).toEqual({ chatbotId: 'bot-1', type: 'POLICY' });
      expect(args.select.content).toBeUndefined();
    });

    it('creates a page on the chatbot and queues it for indexing', async () => {
      knowledgeSource.create.mockResolvedValue({ id: 'src-1' });

      await inTenant(() => sources.createText(page));

      expect(ingestQueue.enqueue).toHaveBeenCalledWith('src-1');

      expect(knowledgeSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { workspaceId: 'ws-1', chatbotId: 'bot-1', ...page },
        }),
      );
    });

    it(`stops at ${KNOWLEDGE_LIMITS.textSources} policy and text pages`, async () => {
      knowledgeSource.count.mockResolvedValue(KNOWLEDGE_LIMITS.textSources);

      await expect(inTenant(() => sources.createText(page))).rejects.toThrow(
        ConflictException,
      );
      expect(knowledgeSource.count).toHaveBeenCalledWith({
        where: { chatbotId: 'bot-1', type: { in: ['POLICY', 'TEXT'] } },
      });
    });

    it('is a 404 for a source that is missing (or another workspace’s)', async () => {
      await expect(sources.get('x')).rejects.toThrow(NotFoundException);
      await expect(sources.updateText('x', { title: 'T' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('queues an edited page for re-indexing', async () => {
      knowledgeSource.findFirst.mockResolvedValue({ type: 'TEXT' });

      await sources.updateText('src-1', { content: 'New' });

      expect(ingestQueue.enqueue).toHaveBeenCalledWith('src-1');

      expect(knowledgeSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'src-1', chatbotId: 'bot-1' },
          data: { content: 'New', status: 'QUEUED', error: null },
        }),
      );
    });

    it("won't edit an uploaded document's text", async () => {
      knowledgeSource.findFirst.mockResolvedValue({ type: 'DOCUMENT' });

      await expect(sources.updateText('src-1', { title: 'T' })).rejects.toThrow(
        BadRequestException,
      );
      expect(knowledgeSource.update).not.toHaveBeenCalled();
    });
  });

  describe('reindex', () => {
    it('queues the source again and clears its error', async () => {
      await sources.reindex('src-1');

      expect(knowledgeSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'src-1', chatbotId: 'bot-1' },
          data: { status: 'QUEUED', error: null },
        }),
      );
      expect(ingestQueue.enqueue).toHaveBeenCalledWith('src-1');
    });

    it("is a 404 for a missing (or another workspace's) source", async () => {
      knowledgeSource.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(sources.reindex('x')).rejects.toThrow(NotFoundException);
      expect(ingestQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('documents', () => {
    const pdf = {
      originalName: 'Return policy.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 ...'),
    };

    it('stores the file, records a queued document and queues it', async () => {
      knowledgeSource.create.mockResolvedValue({ id: 'src-9' });

      await inTenant(() => sources.uploadDocument(pdf));

      expect(ingestQueue.enqueue).toHaveBeenCalledWith('src-9');

      expect(storage.put).toHaveBeenCalledWith(
        'documents',
        'Return policy.pdf',
        pdf.buffer,
        'application/pdf',
      );
      expect(knowledgeSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            workspaceId: 'ws-1',
            chatbotId: 'bot-1',
            type: 'DOCUMENT',
            title: 'Return policy',
            fileKey: 'workspaces/ws-1/documents/u/manual.pdf',
            fileName: 'Return policy.pdf',
            fileSize: pdf.buffer.length,
            mimeType: 'application/pdf',
          },
        }),
      );
    });

    it('uses a given title', async () => {
      await inTenant(() => sources.uploadDocument(pdf, 'Returns'));
      expect(knowledgeSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Returns' }) as unknown,
        }),
      );
    });

    it('rejects a bad file before storing anything', async () => {
      await expect(
        inTenant(() =>
          sources.uploadDocument({ ...pdf, buffer: Buffer.from('not a pdf') }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it(`stops at ${KNOWLEDGE_LIMITS.documents} documents`, async () => {
      knowledgeSource.count.mockResolvedValue(KNOWLEDGE_LIMITS.documents);

      await expect(inTenant(() => sources.uploadDocument(pdf))).rejects.toThrow(
        ConflictException,
      );
      expect(knowledgeSource.count).toHaveBeenCalledWith({
        where: { chatbotId: 'bot-1', type: 'DOCUMENT' },
      });
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('deletes the stored file when the row cannot be saved', async () => {
      knowledgeSource.create.mockRejectedValue(new Error('database down'));

      await expect(inTenant(() => sources.uploadDocument(pdf))).rejects.toThrow(
        'database down',
      );
      expect(ingestQueue.enqueue).not.toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalledWith(
        'workspaces/ws-1/documents/u/manual.pdf',
      );
    });

    it("deletes a document's file with it", async () => {
      knowledgeSource.delete.mockResolvedValue({ fileKey: 'key-1' });

      await sources.remove('src-1');

      expect(storage.delete).toHaveBeenCalledWith('key-1');
    });

    it('still deletes the row when the file is already gone', async () => {
      knowledgeSource.delete.mockResolvedValue({ fileKey: 'key-1' });
      storage.delete.mockRejectedValue(new Error('storage down'));

      await expect(sources.remove('src-1')).resolves.toBeUndefined();
    });

    it('touches no storage when deleting a policy page', async () => {
      knowledgeSource.delete.mockResolvedValue({ fileKey: null });

      await sources.remove('src-1');

      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('custom answers', () => {
    const answer = { triggerQuestion: 'Q', answer: 'A', isActive: true };

    it('creates on the chatbot', async () => {
      await inTenant(() => customAnswers.create(answer));

      expect(customAnswer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { workspaceId: 'ws-1', chatbotId: 'bot-1', ...answer },
        }),
      );
    });

    it(`stops at ${KNOWLEDGE_LIMITS.customAnswers}`, async () => {
      customAnswer.count.mockResolvedValue(KNOWLEDGE_LIMITS.customAnswers);

      await expect(
        inTenant(() => customAnswers.create(answer)),
      ).rejects.toThrow(ConflictException);
      expect(customAnswer.create).not.toHaveBeenCalled();
    });

    it('updates only within the chatbot', async () => {
      await customAnswers.update('ca-1', { isActive: false });

      expect(customAnswer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ca-1', chatbotId: 'bot-1' },
          data: { isActive: false },
        }),
      );
    });
  });
});
