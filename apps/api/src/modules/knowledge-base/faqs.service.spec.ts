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
import { ChatbotService } from '../chatbot/chatbot.service';
import { KnowledgeIngestQueue } from '../knowledge/knowledge-ingest.queue';
import { FaqsService } from './faqs.service';

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'user-1', role: 'ADMIN' }, fn);

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('No record', {
    code: 'P2025',
    clientVersion: 'test',
  });

describe('FaqsService', () => {
  let service: FaqsService;
  let ingestQueue: { enqueue: jest.Mock };
  let faq: {
    findMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    faq = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      create: jest.fn(({ data }: { data: object }) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    };
    ingestQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const db = {
      faq,
      $transaction: jest.fn((fn: (tx: { faq: typeof faq }) => unknown) =>
        fn({ faq }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        FaqsService,
        { provide: TENANT_PRISMA, useValue: db },
        {
          provide: ChatbotService,
          useValue: { currentId: () => Promise.resolve('bot-1') },
        },
        { provide: KnowledgeIngestQueue, useValue: ingestQueue },
      ],
    }).compile();
    service = module.get(FaqsService);
  });

  describe('create', () => {
    it("adds the FAQ last, on the workspace's chatbot", async () => {
      faq.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });

      await inTenant(() => service.create({ question: 'Q', answer: 'A' }));

      expect(faq.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            workspaceId: 'ws-1',
            chatbotId: 'bot-1',
            question: 'Q',
            answer: 'A',
            sortOrder: 5,
          },
        }),
      );
    });

    it('starts at sort order 0', async () => {
      await inTenant(() => service.create({ question: 'Q', answer: 'A' }));

      expect(faq.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sortOrder: 0 }) as unknown,
        }),
      );
    });

    it(`stops at ${KNOWLEDGE_LIMITS.faqs} FAQs (409 LIMIT_REACHED)`, async () => {
      faq.count.mockResolvedValue(KNOWLEDGE_LIMITS.faqs);

      const error = await inTenant(() =>
        service.create({ question: 'Q', answer: 'A' }),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LIMIT_REACHED',
        limit: KNOWLEDGE_LIMITS.faqs,
      });
      expect(faq.create).not.toHaveBeenCalled();
    });
  });

  it('updates only within the chatbot', async () => {
    await service.update('faq-1', { answer: 'New' });

    expect(faq.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'faq-1', chatbotId: 'bot-1' },
        data: { answer: 'New' },
      }),
    );
  });

  it('is a 404 when the FAQ is missing (or another workspace’s)', async () => {
    faq.update.mockRejectedValue(notFound());
    faq.delete.mockRejectedValue(notFound());

    await expect(service.update('x', { answer: 'A' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove('x')).rejects.toThrow(NotFoundException);
  });

  it('passes other database errors through', async () => {
    faq.delete.mockRejectedValue(new Error('connection lost'));
    await expect(service.remove('x')).rejects.toThrow('connection lost');
  });

  describe('re-indexing (M2-13)', () => {
    it('queues a new FAQ', async () => {
      faq.create.mockResolvedValue({ id: 'faq-1' });

      await inTenant(() => service.create({ question: 'Q', answer: 'A' }));

      expect(ingestQueue.enqueue).toHaveBeenCalledWith('faq', 'faq-1');
    });

    it('queues an FAQ whose question or answer changed', async () => {
      await service.update('faq-1', { answer: 'New' });
      expect(ingestQueue.enqueue).toHaveBeenCalledWith('faq', 'faq-1');
    });

    it("doesn't re-index on reorder", async () => {
      faq.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await service.reorder(['b', 'a']);

      expect(ingestQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      faq.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    });

    it('stores each FAQ at its position in the list', async () => {
      await service.reorder(['c', 'a', 'b']);

      expect(faq.update.mock.calls.map(([args]) => args as unknown)).toEqual([
        { where: { id: 'c' }, data: { sortOrder: 0 } },
        { where: { id: 'a' }, data: { sortOrder: 1 } },
        { where: { id: 'b' }, data: { sortOrder: 2 } },
      ]);
    });

    it('is a 404 for an ID that is not one of the chatbot’s FAQs', async () => {
      await expect(service.reorder(['a', 'b', 'zzz'])).rejects.toThrow(
        NotFoundException,
      );
      expect(faq.update).not.toHaveBeenCalled();
    });

    it('is a 400 when an FAQ is left out', async () => {
      await expect(service.reorder(['a', 'b'])).rejects.toThrow(
        BadRequestException,
      );
      expect(faq.update).not.toHaveBeenCalled();
    });
  });
});
