import {
  type ConversationDetail,
  type ConversationListQuery,
  type ConversationMessage,
  type ConversationPage,
  conversationRange,
  type ConversationSummary,
  type PreviewChatSource,
} from '@brainstack/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MessageRole, Prisma } from '../../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { decodeCursor, encodeCursor } from '../products/product-cursor';

/** How much of the visitor's first message the list shows. */
export const FIRST_MESSAGE_CHARS = 140;

const SUMMARY_SELECT = {
  id: true,
  chatbotId: true,
  visitorId: true,
  originUrl: true,
  messageCount: true,
  rating: true,
  startedAt: true,
  lastMessageAt: true,
  messages: {
    where: { role: MessageRole.USER },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { content: true },
  },
  _count: {
    select: { messages: { where: { answeredBy: 'fallback' } } },
  },
} satisfies Prisma.ConversationSelect;

type SummaryRow = Prisma.ConversationGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

function shorten(text: string | undefined): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > FIRST_MESSAGE_CHARS
    ? `${flat.slice(0, FIRST_MESSAGE_CHARS - 1)}…`
    : flat;
}

function toSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    visitorId: row.visitorId,
    originUrl: row.originUrl,
    messageCount: row.messageCount,
    rating: row.rating,
    firstMessage: shorten(row.messages[0]?.content),
    hasFallback: row._count.messages > 0,
    startedAt: row.startedAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}

/** Stored sources are `[{ title, page, similarity }]`; anything else is dropped. */
function toSources(value: Prisma.JsonValue | null): PreviewChatSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const { title, page, similarity } = item as Record<string, unknown>;
    if (typeof title !== 'string') return [];
    return [
      {
        title,
        page: typeof page === 'number' ? page : null,
        similarity: typeof similarity === 'number' ? similarity : 0,
      },
    ];
  });
}

/**
 * The dashboard's conversation inbox (D-2 §2.6, M5-1, M5-2). Reads go
 * through the tenant client, so only the current workspace's live
 * conversations exist here: Test chat (preview) and conversations the
 * visitor opened but never wrote in are left out.
 */
@Injectable()
export class ConversationInboxService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /** Latest activity first, `limit` per page; `nextCursor` is null on the last page. */
  async list(query: ConversationListQuery): Promise<ConversationPage> {
    const filters: Prisma.ConversationWhereInput[] = [
      { isPreview: false, messageCount: { gt: 0 } },
    ];
    if (query.chatbotId) filters.push({ chatbotId: query.chatbotId });
    const { from, to } = conversationRange(query);
    if (from) filters.push({ startedAt: { gte: from } });
    if (to) filters.push({ startedAt: { lt: to } });
    if (query.rating) {
      filters.push({
        rating: query.rating === 'none' ? null : Number(query.rating),
      });
    }
    if (query.q) {
      filters.push({
        messages: {
          some: { content: { contains: query.q, mode: 'insensitive' } },
        },
      });
    }
    if (query.cursor) {
      const after = decodeCursor(query.cursor);
      filters.push({
        OR: [
          { lastMessageAt: { lt: after.createdAt } },
          { lastMessageAt: after.createdAt, id: { lt: after.id } },
        ],
      });
    }

    // One extra row tells whether another page exists.
    const rows = await this.db.conversation.findMany({
      where: { AND: filters },
      select: SUMMARY_SELECT,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toSummary),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.lastMessageAt, id: last.id })
          : null,
    };
  }

  /** The whole transcript; another workspace's or a preview conversation is a 404. */
  async detail(id: string): Promise<ConversationDetail> {
    const row = await this.db.conversation.findFirst({
      where: { id, isPreview: false },
      select: {
        ...SUMMARY_SELECT,
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            role: true,
            content: true,
            sources: true,
            answeredBy: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Conversation not found');

    const messages: ConversationMessage[] = row.messages.map((m) => ({
      id: m.id,
      role: m.role === MessageRole.USER ? 'user' : 'assistant',
      text: m.content,
      sources: toSources(m.sources),
      answeredBy: m.answeredBy,
      createdAt: m.createdAt.toISOString(),
    }));
    const firstUser = row.messages.find((m) => m.role === MessageRole.USER);
    return {
      ...toSummary({ ...row, messages: firstUser ? [firstUser] : [] }),
      messages,
    };
  }

  /**
   * Deletes a conversation for privacy (M5-3); its messages go with it
   * (`ON DELETE CASCADE`). Another workspace's or a preview conversation
   * is a 404, as in detail().
   */
  async remove(id: string): Promise<void> {
    const deleted = await this.db.conversation.deleteMany({
      where: { id, isPreview: false },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Conversation not found');
    }
  }
}
