import type { AnswerTimings, PreviewChatSource } from '@brainstack/shared';
import { Inject, Injectable } from '@nestjs/common';
import { MessageRole } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import {
  TENANT_PRISMA,
  type TenantDb,
  type TenantPrisma,
} from '../../tenancy/tenant-prisma';

export type AnsweredBy = 'llm' | 'custom_answer' | 'fallback';

/** How an answer was made, saved with the assistant's message (M3-11). */
export interface AnswerDetails {
  content: string;
  sources: PreviewChatSource[];
  answeredBy: AnsweredBy;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  /** Where the time went (M7-40). */
  timings: AnswerTimings;
}

export interface RecordTurn {
  chatbotId: string;
  /** Continue this conversation, if it is the same visitor's; otherwise a new one starts. */
  conversationId?: string;
  visitorId: string;
  isPreview: boolean;
  /** The published version that answered; null for the draft preview. */
  versionId?: string | null;
  userText: string;
  answer: AnswerDetails;
}

/**
 * Saves a visitor's message and the bot's answer in the current workspace
 * (M3-5, M3-11). Must run inside a tenant context: the tenant client adds
 * the workspace to every query.
 */
@Injectable()
export class ConversationsService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /** An empty live conversation, started by a visitor opening the chat. */
  async start(input: {
    chatbotId: string;
    visitorId: string;
    originUrl: string | null;
    versionId: string;
  }): Promise<string> {
    const { workspaceId } = requireTenant();
    const created = await this.db.conversation.create({
      data: {
        workspaceId,
        chatbotId: input.chatbotId,
        visitorId: input.visitorId,
        originUrl: input.originUrl,
        versionId: input.versionId,
        isPreview: false,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** A live conversation of this chatbot, or null. */
  find(conversationId: string, chatbotId: string) {
    return this.db.conversation.findFirst({
      where: { id: conversationId, chatbotId, isPreview: false },
      select: { id: true, visitorId: true, messageCount: true },
    });
  }

  /**
   * Saves the visitor's 1–5 stars on a live conversation of this chatbot
   * (FR-4.6, M5-7); a later rating replaces the earlier one. False when
   * there is no such conversation.
   */
  async rate(
    conversationId: string,
    chatbotId: string,
    rating: number,
  ): Promise<boolean> {
    const rated = await this.db.conversation.updateMany({
      where: { id: conversationId, chatbotId, isPreview: false },
      data: { rating },
    });
    return rated.count === 1;
  }

  /** What a visitor sees again after a reload, oldest first. */
  async messages(
    conversationId: string,
  ): Promise<
    { id: string; role: 'user' | 'assistant'; text: string; createdAt: Date }[]
  > {
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      role: row.role === MessageRole.USER ? 'user' : 'assistant',
      text: row.content,
      createdAt: row.createdAt,
    }));
  }

  /**
   * The latest turns of a conversation, oldest first, for the prompt. A
   * conversation that isn't this chatbot's, this visitor's or this kind
   * (preview or live) is empty, exactly as recordTurn() treats it.
   */
  async recentTurns(
    scope: Pick<RecordTurn, 'chatbotId' | 'visitorId' | 'isPreview'> & {
      conversationId: string;
    },
    limit: number,
    db: TenantDb = this.db,
  ): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
    const rows = await db.message.findMany({
      where: {
        conversationId: scope.conversationId,
        conversation: {
          chatbotId: scope.chatbotId,
          visitorId: scope.visitorId,
          isPreview: scope.isPreview,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true },
    });
    return rows.reverse().map((row) => ({
      role: row.role === MessageRole.USER ? 'user' : 'assistant',
      text: row.content,
    }));
  }

  /** Returns the conversation's ID. */
  async recordTurn(turn: RecordTurn): Promise<string> {
    const { workspaceId } = requireTenant();
    const now = new Date();
    const messages = [
      // Explicit, ordered times: a single insert gives both rows the same default.
      { role: MessageRole.USER, content: turn.userText, createdAt: now },
      {
        role: MessageRole.ASSISTANT,
        content: turn.answer.content,
        createdAt: new Date(now.getTime() + 1),
        sources: turn.answer.sources as unknown as object,
        answeredBy: turn.answer.answeredBy,
        model: turn.answer.model,
        tokensIn: turn.answer.tokensIn,
        tokensOut: turn.answer.tokensOut,
        latencyMs: turn.answer.latencyMs,
        timings: turn.answer.timings as unknown as object,
      },
    ];

    // One transaction for the whole write (M7-32): one RLS round trip, not
    // two, and the counter and the messages can't drift apart.
    return this.db.$transaction(async (tx) => {
      // updateMany so a conversation of another chatbot, visitor or kind
      // matches nothing and a new one starts instead.
      if (turn.conversationId) {
        const continued = await tx.conversation.updateMany({
          where: {
            id: turn.conversationId,
            chatbotId: turn.chatbotId,
            visitorId: turn.visitorId,
            isPreview: turn.isPreview,
          },
          data: { messageCount: { increment: 2 }, lastMessageAt: now },
        });
        if (continued.count === 1) {
          await tx.message.createMany({
            data: messages.map((m) => ({
              ...m,
              workspaceId,
              conversationId: turn.conversationId!,
            })),
          });
          return turn.conversationId;
        }
      }

      const created = await tx.conversation.create({
        data: {
          workspaceId,
          chatbotId: turn.chatbotId,
          visitorId: turn.visitorId,
          isPreview: turn.isPreview,
          versionId: turn.versionId ?? null,
          messageCount: 2,
          startedAt: now,
          lastMessageAt: now,
          messages: {
            create: messages.map((m) => ({ ...m, workspaceId })),
          },
        },
        select: { id: true },
      });
      return created.id;
    });
  }
}
