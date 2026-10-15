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
import { LlmKeysService } from '../llm-keys/llm-keys.service';
import { buildPreviewMessages } from './preview-prompt';

/** D-2 §5: preview messages per user per minute. */
export const PREVIEW_RATE_LIMIT = { limit: 30, windowSeconds: 60 };

// Chat runs on the workspace's own keys (M3-21); with none, it's off.
export const NO_CREDENTIALS_REPLY =
  'Chat is off until you add your own LLM API key in Settings → AI.';
export const KEYS_EXHAUSTED_REPLY =
  'None of your API keys worked just now (busy, out of credit, or no longer valid). Try again in a minute, or check them in Settings → AI.';

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
  ) {}

  async send(
    userId: string,
    request: PreviewChatRequest,
  ): Promise<PreviewChatReply> {
    await this.rateLimit.consume({
      key: `preview:user:${userId}`,
      ...PREVIEW_RATE_LIMIT,
    });

    const credentials = await this.keys.activeCredentials();
    if (credentials.length === 0) {
      // No key, no LLM call: skip the search too.
      return { reply: NO_CREDENTIALS_REPLY, sources: [] };
    }

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
      const answer = await this.llm.completeWith(credentials, messages);
      void this.keys.markUsed(answer.credentialId);
      reply =
        answer.message.content?.trim() || bot.config.behavior.fallbackMessage;
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
