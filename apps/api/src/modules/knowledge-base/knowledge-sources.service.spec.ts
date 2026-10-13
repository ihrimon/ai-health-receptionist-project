import { KNOWLEDGE_LIMITS } from '@brainstack/shared';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
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

  beforeEach(async () => {
    knowledgeSource = mockModel();
    customAnswer = mockModel();
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeSourcesService,
        CustomAnswersService,
        { provide: TENANT_PRISMA, useValue: { knowledgeSource, customAnswer } },
        {
          provide: ChatbotService,
          useValue: { currentId: () => Promise.resolve('bot-1') },
        },
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

    it('creates a page on the chatbot, queued for indexing by default', async () => {
      await inTenant(() => sources.createText(page));

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
