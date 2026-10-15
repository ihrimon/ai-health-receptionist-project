import type {
  ChatbotConfig,
  PreviewChatReply,
  PreviewChatRequest,
  PreviewChatSource,
} from '@brainstack/shared';
import { Injectable, Logger } from '@nestjs/common';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { LlmChatClient } from '../llm/llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from '../llm/llm-key-manager';
import {
  type KnowledgeMatch,
  KnowledgeService,
} from '../knowledge/knowledge.service';
import {
  type AnsweredBy,
  type AnswerDetails,
  ConversationsService,
} from '../conversations/conversations.service';
import { LlmKeysService } from '../llm-keys/llm-keys.service';
import { buildPreviewMessages } from './preview-prompt';

/** D-2 §5: preview messages per user per minute. */
export const PREVIEW_RATE_LIMIT = { limit: 30, windowSeconds: 60 };

// Chat runs on the workspace's own keys (M3-21); with none, it's off.
export const NO_CREDENTIALS_REPLY =
  'Chat is off until you add your own LLM API key in Settings → AI.';
export const KEYS_EXHAUSTED_REPLY =
  'None of your API keys worked just now (busy, out of credit, or no longer valid). Try again in a minute, or check them in Settings → AI.';

/** Who is asking and how the chat is stored (M3-5). */
export interface AnswerContext {
  isPreview: boolean;
  visitorId: string;
  /** The published version answering; null for the draft preview. */
  versionId: string | null;
}

/**
 * Dashboard "Test chat" (M3-13): answers from the workspace's own
 * knowledge with the draft config. MVP: no streaming, nothing stored, the
 * browser keeps the history. M3-3 onward replaces it with the full pipeline.
 */
@Injectable()
export class PreviewChatService {
  private readonly logger = new Logger(PreviewChatService.name);

  constructor(
    private readonly chatbot: ChatbotService,
    private readonly knowledge: KnowledgeService,
    private readonly llm: LlmChatClient,
    private readonly rateLimit: RateLimitService,
    private readonly keys: LlmKeysService,
    private readonly conversations: ConversationsService,
  ) {}

  async send(
    userId: string,
    request: PreviewChatRequest,
  ): Promise<PreviewChatReply> {
    await this.rateLimit.consume({
      key: `preview:user:${userId}`,
      ...PREVIEW_RATE_LIMIT,
    });

    const bot = await this.chatbot.draft();
    return this.answer(bot.id, bot.config, request, {
      isPreview: true,
      visitorId: userId,
      versionId: null,
    });
  }

  /**
   * One answer from the current workspace's knowledge, with `config`, on
   * its own keys, saved as a stored conversation (M3-5, M3-11). Must run
   * in that workspace's tenant context; the public widget
   * (PublicChatService) calls it with the published config.
   */
  async answer(
    botId: string,
    config: ChatbotConfig,
    request: PreviewChatRequest,
    context: AnswerContext,
  ): Promise<PreviewChatReply> {
    const credentials = await this.keys.activeCredentials();
    if (credentials.length === 0) {
      // No key, no LLM call: skip the search too.
      return {
        reply: NO_CREDENTIALS_REPLY,
        sources: [],
        conversationId: request.conversationId ?? null,
      };
    }
    const startedAt = Date.now();

    const matches = await this.knowledge.search(botId, request.message);
    const messages = buildPreviewMessages(
      config,
      matches,
      request.history,
      request.message,
    );

    let reply: string;
    let answeredBy: AnsweredBy;
    let model: string | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    try {
      const answer = await this.llm.completeWith(credentials, messages);
      void this.keys.markUsed(answer.credentialId);
      const text = answer.message.content?.trim();
      reply = text || config.behavior.fallbackMessage;
      answeredBy = text ? 'llm' : 'fallback';
      model = answer.model;
      tokensIn = answer.usage?.inputTokens ?? null;
      tokensOut = answer.usage?.outputTokens ?? null;
    } catch (err) {
      if (err instanceof NoLlmCredentialsConfiguredError) {
        reply = NO_CREDENTIALS_REPLY;
      } else if (err instanceof AllLlmKeysExhaustedError) {
        reply = KEYS_EXHAUSTED_REPLY;
      } else {
        throw err;
      }
      this.logger.warn(`Preview chat without an answer: ${String(err)}`);
      // Nothing was answered, so there is nothing to store.
      return {
        reply,
        sources: [],
        conversationId: request.conversationId ?? null,
      };
    }

    const sources = matches.map(toSource);
    const conversationId = await this.store(botId, request, context, {
      content: reply,
      sources,
      answeredBy,
      model,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - startedAt,
    });
    return { reply, sources, conversationId };
  }

  /** A storing failure must not lose the visitor's answer. */
  private async store(
    botId: string,
    request: PreviewChatRequest,
    context: AnswerContext,
    answer: AnswerDetails,
  ): Promise<string | null> {
    try {
      return await this.conversations.recordTurn({
        chatbotId: botId,
        conversationId: request.conversationId,
        visitorId: context.visitorId,
        isPreview: context.isPreview,
        versionId: context.versionId,
        userText: request.message,
        answer,
      });
    } catch (err) {
      this.logger.error(`Could not store the chat turn: ${String(err)}`);
      return null;
    }
  }
}

function toSource(match: KnowledgeMatch): PreviewChatSource {
  return {
    title: match.metadata.title,
    page: match.metadata.page ?? null,
    similarity: Math.round(Number(match.similarity) * 100) / 100,
  };
}
