import {
  conversationListQuerySchema,
  conversationRange,
} from '@brainstack/shared';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageRole } from '../../generated/prisma/client';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { encodeCursor } from '../products/product-cursor';
import {
  ConversationInboxService,
  FIRST_MESSAGE_CHARS,
} from './conversation-inbox.service';

const parse = (query: Record<string, string>) =>
  conversationListQuerySchema.parse(query);

describe('conversationListQuerySchema', () => {
  it('defaults the page size and accepts every filter', () => {
    expect(parse({})).toEqual({ limit: 20 });
    expect(
      parse({
        chatbotId: '7d3c1d3e-8f1a-4c55-9d43-3b2a6f0b9e11',
        from: '2026-10-01',
        to: '2026-10-17T12:00:00Z',
        rating: 'none',
        q: '  shipping ',
        limit: '50',
      }),
    ).toMatchObject({ q: 'shipping', rating: 'none', limit: 50 });
  });

  it('rejects bad dates, ratings, ranges and unknown fields', () => {
    const bad = [
      { from: 'yesterday' },
      { to: '2026-13-45' },
      { rating: '6' },
      { from: '2026-10-18', to: '2026-10-17' },
      { chatbotId: 'not-a-uuid' },
      { limit: '0' },
      { hasLead: 'true' },
    ];
    for (const query of bad) {
      expect(conversationListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('a bare `to` day includes the whole day', () => {
    expect(conversationRange({ from: '2026-10-17', to: '2026-10-17' })).toEqual(
      {
        from: new Date('2026-10-17T00:00:00Z'),
        to: new Date('2026-10-18T00:00:00Z'),
      },
    );
    expect(conversationRange({ to: '2026-10-17T09:30:00Z' }).to).toEqual(
      new Date('2026-10-17T09:30:00Z'),
    );
  });
});

describe('ConversationInboxService', () => {
  const db = {
    conversation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  let service: ConversationInboxService;

  const row = (id: string, at: string, extra: object = {}) => ({
    id,
    chatbotId: 'bot-1',
    visitorId: 'visitor-1',
    originUrl: 'https://shop.example/wallet',
    messageCount: 4,
    rating: null,
    startedAt: new Date(at),
    lastMessageAt: new Date(at),
    messages: [{ content: 'Do you ship\n to Chittagong?' }],
    _count: { messages: 0 },
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationInboxService,
        { provide: TENANT_PRISMA, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(ConversationInboxService);
  });

  type FindManyArgs = {
    where: { AND: object[] };
    take: number;
    orderBy: object[];
  };
  const listArgs = () =>
    (db.conversation.findMany.mock.calls as [FindManyArgs][])[0][0];

  it('lists live, non-empty conversations, latest activity first, with a cursor', async () => {
    db.conversation.findMany.mockResolvedValue([
      row('c-2', '2026-10-17T10:00:00Z', { _count: { messages: 1 } }),
      row('c-1', '2026-10-16T10:00:00Z'),
      row('c-0', '2026-10-15T10:00:00Z'),
    ]);

    const page = await service.list(parse({ limit: '2' }));

    const args = listArgs();
    expect(args.take).toBe(3);
    expect(args.where.AND).toEqual([
      { isPreview: false, messageCount: { gt: 0 } },
    ]);
    expect(args.orderBy).toEqual([{ lastMessageAt: 'desc' }, { id: 'desc' }]);
    expect(page.items.map((i) => i.id)).toEqual(['c-2', 'c-1']);
    expect(page.items[0]).toMatchObject({
      firstMessage: 'Do you ship to Chittagong?',
      hasFallback: true,
      lastMessageAt: '2026-10-17T10:00:00.000Z',
    });
    expect(page.items[1].hasFallback).toBe(false);
    expect(page.nextCursor).toBe(
      encodeCursor({ createdAt: new Date('2026-10-16T10:00:00Z'), id: 'c-1' }),
    );
  });

  it('turns filters, search and the cursor into one query', async () => {
    db.conversation.findMany.mockResolvedValue([]);
    const cursor = encodeCursor({
      createdAt: new Date('2026-10-16T10:00:00Z'),
      id: '7d3c1d3e-8f1a-4c55-9d43-3b2a6f0b9e11',
    });

    const page = await service.list(
      parse({
        chatbotId: '11111111-1111-4111-8111-111111111111',
        from: '2026-10-01',
        to: '2026-10-16',
        rating: '4',
        q: 'refund',
        cursor,
      }),
    );

    expect(page).toEqual({ items: [], nextCursor: null });
    expect(listArgs().where.AND).toEqual([
      { isPreview: false, messageCount: { gt: 0 } },
      { chatbotId: '11111111-1111-4111-8111-111111111111' },
      { startedAt: { gte: new Date('2026-10-01T00:00:00Z') } },
      { startedAt: { lt: new Date('2026-10-17T00:00:00Z') } },
      { rating: 4 },
      {
        messages: {
          some: { content: { contains: 'refund', mode: 'insensitive' } },
        },
      },
      {
        OR: [
          { lastMessageAt: { lt: new Date('2026-10-16T10:00:00Z') } },
          {
            lastMessageAt: new Date('2026-10-16T10:00:00Z'),
            id: { lt: '7d3c1d3e-8f1a-4c55-9d43-3b2a6f0b9e11' },
          },
        ],
      },
    ]);
  });

  it('`rating=none` finds unrated conversations, and a bad cursor is a 400', async () => {
    db.conversation.findMany.mockResolvedValue([]);
    await service.list(parse({ rating: 'none' }));
    expect(listArgs().where.AND).toContainEqual({ rating: null });

    await expect(service.list(parse({ cursor: 'garbage' }))).rejects.toThrow(
      'Invalid cursor',
    );
  });

  it('shortens a long first message', async () => {
    db.conversation.findMany.mockResolvedValue([
      row('c-1', '2026-10-16T10:00:00Z', {
        messages: [{ content: 'x'.repeat(500) }],
      }),
    ]);
    const { items } = await service.list(parse({}));
    expect(items[0].firstMessage).toHaveLength(FIRST_MESSAGE_CHARS);
    expect(items[0].firstMessage?.endsWith('…')).toBe(true);
  });

  it('returns the whole transcript with each answer’s sources', async () => {
    db.conversation.findFirst.mockResolvedValue(
      row('c-1', '2026-10-16T10:00:00Z', {
        _count: { messages: 1 },
        messages: [
          {
            id: 'm-1',
            role: MessageRole.USER,
            content: 'Return policy?',
            sources: null,
            answeredBy: null,
            createdAt: new Date('2026-10-16T10:00:00Z'),
          },
          {
            id: 'm-2',
            role: MessageRole.ASSISTANT,
            content: '30 days.',
            sources: [
              { title: 'Returns', page: 2, similarity: 0.81 },
              { nonsense: true },
            ],
            answeredBy: 'llm',
            createdAt: new Date('2026-10-16T10:00:01Z'),
          },
        ],
      }),
    );

    const detail = await service.detail('c-1');

    const [[args]] = db.conversation.findFirst.mock.calls as [
      [{ where: object }],
    ];
    expect(args.where).toEqual({ id: 'c-1', isPreview: false });
    expect(detail).toMatchObject({
      id: 'c-1',
      originUrl: 'https://shop.example/wallet',
      firstMessage: 'Return policy?',
      hasFallback: true,
    });
    expect(detail.messages).toEqual([
      {
        id: 'm-1',
        role: 'user',
        text: 'Return policy?',
        sources: [],
        answeredBy: null,
        createdAt: '2026-10-16T10:00:00.000Z',
      },
      {
        id: 'm-2',
        role: 'assistant',
        text: '30 days.',
        sources: [{ title: 'Returns', page: 2, similarity: 0.81 }],
        answeredBy: 'llm',
        createdAt: '2026-10-16T10:00:01.000Z',
      },
    ]);
  });

  it('a conversation it cannot see is a 404', async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    await expect(service.detail('c-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes a live conversation; one it cannot see is a 404 (M5-3)', async () => {
    db.conversation.deleteMany.mockResolvedValueOnce({ count: 1 });
    await service.remove('c-1');
    expect(db.conversation.deleteMany).toHaveBeenCalledWith({
      where: { id: 'c-1', isPreview: false },
    });

    db.conversation.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove('c-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
