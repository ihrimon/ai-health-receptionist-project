import type {
  PreviewChatReply,
  PreviewChatRequest,
  PreviewChatSource,
} from '@brainstack/shared';
import { Injectable, Logger } from '@nestjs/common';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { LlmChatClient } from '../chat/llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from '../chat/llm-key-manager';
import {
  type KnowledgeMatch,
  KnowledgeService,
} from '../knowledge/knowledge.service';
import { buildPreviewMessages } from './preview-prompt';

/** D-2 §5: preview messages per user per minute. */
export const PREVIEW_RATE_LIMIT = { limit: 30, windowSeconds: 60 };

export const NO_CREDENTIALS_REPLY =
  "The AI model isn't set up yet: a platform admin needs to add an LLM API key.";
export const KEYS_EXHAUSTED_REPLY =
  'The AI model is busy right now. Please try again in a minute.';

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
    const matches = await this.knowledge.search(bot.id, request.message);
    const messages = buildPreviewMessages(
      bot.config,
      matches,
      request.history,
      request.message,
    );

    let reply: string;
    try {
      const answer = await this.llm.complete(messages);
      reply = answer.content?.trim() || bot.config.behavior.fallbackMessage;
    } catch (err) {
      if (err instanceof NoLlmCredentialsConfiguredError) {
        reply = NO_CREDENTIALS_REPLY;
      } else if (err instanceof AllLlmKeysExhaustedError) {
        reply = KEYS_EXHAUSTED_REPLY;
      } else {
        throw err;
      }
      this.logger.warn(`Preview chat without an answer: ${String(err)}`);
    }

    return { reply, sources: matches.map(toSource) };
  }
}

function toSource(match: KnowledgeMatch): PreviewChatSource {
  return {
    title: match.metadata.title,
    page: match.metadata.page ?? null,
    similarity: Math.round(Number(match.similarity) * 100) / 100,
  };
}
