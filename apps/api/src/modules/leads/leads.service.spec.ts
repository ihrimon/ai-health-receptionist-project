import { leadInputSchema, leadListQuerySchema } from '@brainstack/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { encodeCursor } from '../products/product-cursor';
import { LeadsService } from './leads.service';

const BOT = '11111111-1111-4111-8111-111111111111';
const CONVO = '22222222-2222-4222-8222-222222222222';

describe('leadInputSchema', () => {
  it('trims, lower-cases the email and drops blanks', () => {
    expect(
      leadInputSchema.parse({
        name: '  Ana  ',
        email: ' Ana@Example.COM ',
        phone: '',
        answers: { budget: ' 5000 ', colour: '' },
      }),
    ).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      answers: { budget: '5000' },
    });
  });

  it('rejects an empty lead, a bad email or phone and unknown fields', () => {
    const bad = [
      {},
      { name: '   ' },
      { email: 'not-an-email' },
      { phone: 'call me maybe' },
      { name: 'x'.repeat(101) },
      { answers: { 'bad key!': 'x' } },
      { name: 'Ana', company: 'Acme' },
    ];
    for (const input of bad) {
      expect(leadInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('LeadsService', () => {
  const db = {
    chatbot: { findFirst: jest.fn(), findMany: jest.fn() },
    conversation: { findFirst: jest.fn() },
    lead: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  let service: LeadsService;

  const row = (id: string, at: string, extra: object = {}) => ({
    id,
    chatbotId: BOT,
    conversationId: CONVO,
    name: 'Ana',
    email: 'ana@example.com',
    phone: null,
    answers: {},
    sourceUrl: 'https://shop.example/wallet',
    createdAt: new Date(at),
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    db.chatbot.findMany.mockResolvedValue([
      {
        id: BOT,
        draftConfig: {
          behavior: {
            questionsToAsk: [{ id: 'budget', question: 'Your budget?' }],
          },
        },
        publishedVersion: {
          config: {
            behavior: {
              questionsToAsk: [
                { id: 'budget', question: 'Old budget question' },
                { id: 'city', question: 'Which city?' },
              ],
            },
          },
        },
      },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [LeadsService, { provide: TENANT_PRISMA, useValue: db }],
    }).compile();
    service = moduleRef.get(LeadsService);
  });

  describe('create (for capture_lead, M5-4)', () => {
    // The capture_lead tool runs inside a visitor chat's workspace context.
    const create = (input: Parameters<LeadsService['create']>[0]) =>
      runWithTenant({ workspaceId: 'ws-1', userId: 'u-1', role: 'ADMIN' }, () =>
        service.create(input),
      );
    it('saves a lead on its conversation and copies the source page', async () => {
      db.chatbot.findFirst.mockResolvedValue({ id: BOT });
      db.conversation.findFirst.mockResolvedValue({
        originUrl: 'https://shop.example/wallet',
        lead: null,
      });
      db.lead.create.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({
          ...row('lead-1', '2026-10-17T10:00:00Z'),
          ...data,
        }),
      );

      const lead = await create({
        chatbotId: BOT,
        conversationId: CONVO,
        name: ' Ana ',
        email: 'ANA@example.com',
        answers: { budget: '5000', city: 'Dhaka' },
      });

      expect(db.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CONVO, chatbotId: BOT } }),
      );
      expect(db.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            workspaceId: 'ws-1',
            chatbotId: BOT,
            conversationId: CONVO,
            name: 'Ana',
            email: 'ana@example.com',
            phone: null,
            answers: { budget: '5000', city: 'Dhaka' },
            sourceUrl: 'https://shop.example/wallet',
          },
        }),
      );
      // The draft's question text wins over the live one.
      expect(lead.answers).toEqual([
        { questionId: 'budget', question: 'Your budget?', answer: '5000' },
        { questionId: 'city', question: 'Which city?', answer: 'Dhaka' },
      ]);
      expect(lead.createdAt).toBe('2026-10-17T10:00:00.000Z');
    });

    it('fills in the same lead when the chat already has one', async () => {
      db.chatbot.findFirst.mockResolvedValue({ id: BOT });
      db.conversation.findFirst.mockResolvedValue({
        originUrl: null,
        lead: row('lead-1', '2026-10-17T10:00:00Z', {
          answers: { budget: '5000' },
        }),
      });
      db.lead.update.mockResolvedValue(row('lead-1', '2026-10-17T10:00:00Z'));

      await create({
        chatbotId: BOT,
        conversationId: CONVO,
        phone: '+880 1711-000000',
        answers: { city: 'Dhaka' },
      });

      expect(db.lead.create).not.toHaveBeenCalled();
      expect(db.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: {
            phone: '+880 1711-000000',
            answers: { budget: '5000', city: 'Dhaka' },
          },
        }),
      );
    });

    it('merges into the other capture when two race in one chat', async () => {
      db.chatbot.findFirst.mockResolvedValue({ id: BOT });
      db.conversation.findFirst
        .mockResolvedValueOnce({ originUrl: null, lead: null })
        .mockResolvedValueOnce({
          originUrl: null,
          lead: row('lead-1', '2026-10-17T10:00:00Z'),
        });
      db.lead.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      db.lead.update.mockResolvedValue(row('lead-1', '2026-10-17T10:00:00Z'));

      const lead = await create({
        chatbotId: BOT,
        conversationId: CONVO,
        name: 'Ana',
      });
      expect(lead.id).toBe('lead-1');
      expect(db.lead.update).toHaveBeenCalledTimes(1);
    });

    it("is a 404 for a chatbot or conversation it can't see, a 400 for an empty lead", async () => {
      db.chatbot.findFirst.mockResolvedValue(null);
      await expect(
        create({ chatbotId: BOT, name: 'Ana' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      db.chatbot.findFirst.mockResolvedValue({ id: BOT });
      db.conversation.findFirst.mockResolvedValue(null);
      await expect(
        create({ chatbotId: BOT, conversationId: CONVO, name: 'Ana' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await expect(
        create({ chatbotId: BOT, email: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.lead.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    type FindManyArgs = { where: { AND: object[] }; take: number };
    const listArgs = (call = 0) =>
      (db.lead.findMany.mock.calls as [FindManyArgs][])[call][0];

    it('pages newest first with a cursor and labels the answers', async () => {
      db.lead.findMany.mockResolvedValue([
        row('l-3', '2026-10-17T10:00:00Z', { answers: { gone: 'x', n: 1 } }),
        row('l-2', '2026-10-16T10:00:00Z'),
        row('l-1', '2026-10-15T10:00:00Z'),
      ]);

      const page = await service.list(
        leadListQuerySchema.parse({ limit: '2' }),
      );

      expect(listArgs().take).toBe(3);
      expect(listArgs().where.AND).toEqual([]);
      expect(page.items.map((l) => l.id)).toEqual(['l-3', 'l-2']);
      // A non-text answer is dropped; a removed question has no label.
      expect(page.items[0].answers).toEqual([
        { questionId: 'gone', question: null, answer: 'x' },
      ]);
      expect(page.nextCursor).toBe(
        encodeCursor({
          createdAt: new Date('2026-10-16T10:00:00Z'),
          id: 'l-2',
        }),
      );
    });

    it('turns dates, search and the cursor into one query', async () => {
      db.lead.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        createdAt: new Date('2026-10-16T10:00:00Z'),
        id: '7d3c1d3e-8f1a-4c55-9d43-3b2a6f0b9e11',
      });

      const page = await service.list(
        leadListQuerySchema.parse({
          chatbotId: BOT,
          from: '2026-10-01',
          to: '2026-10-16',
          q: ' ana ',
          cursor,
        }),
      );

      expect(page).toEqual({ items: [], nextCursor: null });
      const contains = { contains: 'ana', mode: 'insensitive' };
      expect(listArgs().where.AND).toEqual([
        { chatbotId: BOT },
        { createdAt: { gte: new Date('2026-10-01T00:00:00Z') } },
        { createdAt: { lt: new Date('2026-10-17T00:00:00Z') } },
        { OR: [{ name: contains }, { email: contains }, { phone: contains }] },
        {
          OR: [
            { createdAt: { lt: new Date('2026-10-16T10:00:00Z') } },
            {
              createdAt: new Date('2026-10-16T10:00:00Z'),
              id: { lt: '7d3c1d3e-8f1a-4c55-9d43-3b2a6f0b9e11' },
            },
          ],
        },
      ]);
      // No rows, no chatbot lookup.
      expect(db.chatbot.findMany).not.toHaveBeenCalled();
    });
  });

  it('exports every matching lead in batches as CSV', async () => {
    const batch = Array.from({ length: 500 }, (_, i) =>
      row(`l-${i}`, new Date(Date.UTC(2026, 9, 17) - i * 1000).toISOString()),
    );
    db.lead.findMany
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([
        row('last', '2026-01-01T00:00:00Z', { name: '@risky' }),
      ]);

    const csv = await service.exportCsv({});

    expect(db.lead.findMany).toHaveBeenCalledTimes(2);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(502);
    expect(lines.at(-1)).toContain(",'@risky,");
  });

  it("deleting a lead it can't see is a 404", async () => {
    db.lead.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('l-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    db.lead.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.remove('l-1')).resolves.toBeUndefined();
  });
});
