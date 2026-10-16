import {
  type ChatbotConfig,
  PREVIEW_CHAT_LIMITS,
  type PreviewChatRequest,
  type PreviewChatSource,
} from '@brainstack/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { EmitChatEvent } from '../../common/sse';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import {
  type AnsweredBy,
  type AnswerDetails,
  ConversationsService,
} from '../conversations/conversations.service';
import { LlmChatClient } from '../llm/llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  NoLlmCredentialsConfiguredError,
} from '../llm/llm-key-manager';
import {
  type KnowledgeMatch,
  KnowledgeService,
} from '../knowledge/knowledge.service';
import { LlmKeysService } from '../llm-keys/llm-keys.service';
import { buildPreviewMessages } from './preview-prompt';
import { isSmallTalk } from './small-talk';

/** D-2 §5: preview messages per user per minute. */
export const PREVIEW_RATE_LIMIT = { limit: 30, windowSeconds: 60 };

// Chat runs on the workspace's own keys (M3-21); with none, it's off.
export const NO_CREDENTIALS_REPLY =
  'Chat is off until you add your own LLM API key in Settings → AI.';
export const KEYS_EXHAUSTED_REPLY =
  'None of your API keys worked just now (busy, out of credit, or no longer valid). Try again in a minute, or check them in Settings → AI.';

/** Who is asking, how the chat is stored (M3-5) and what is shown. */
export interface AnswerContext {
  isPreview: boolean;
  visitorId: string;
  /** The published version answering; null for the draft preview. */
  versionId: string | null;
  /** Dashboard only: send the knowledge the answer is built from. */
  includeSources: boolean;
  /** What to say when the workspace has no key, or none of its keys work. */
  noCredentialsReply: string;
  keysExhaustedReply: string;
}

/**
 * Dashboard "Test chat" (M3-13): answers from the workspace's own
 * knowledge with the draft config, streaming as it is generated (M3-3).
 * Conversations are stored and their history comes from the server.
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
    emit: EmitChatEvent,
  ): Promise<void> {
    await this.rateLimit.consume({
      key: `preview:user:${userId}`,
      ...PREVIEW_RATE_LIMIT,
    });

    const bot = await this.chatbot.draft();
    await this.answer(bot.id, bot.config, request, emit, {
      isPreview: true,
      visitorId: userId,
      versionId: null,
      includeSources: true,
      noCredentialsReply: NO_CREDENTIALS_REPLY,
      keysExhaustedReply: KEYS_EXHAUSTED_REPLY,
    });
  }

  /**
   * One streamed answer from the current workspace's knowledge, with
   * `config`, on its own keys, saved as a stored conversation (M3-5,
   * M3-11). Must run in that workspace's tenant context; the public widget
   * (PublicChatService) calls it with the published config.
   */
  async answer(
    botId: string,
    config: ChatbotConfig,
    request: PreviewChatRequest,
    emit: EmitChatEvent,
    context: AnswerContext,
  ): Promise<void> {
    const unstored = (text: string) => {
      emit({ type: 'delta', text });
      emit({
        type: 'done',
        conversationId: request.conversationId ?? null,
        answeredBy: 'fallback',
      });
    };

    const credentials = await this.keys.activeCredentials();
    if (credentials.length === 0) {
      // No key, no LLM call: skip the search too.
      unstored(context.noCredentialsReply);
      return;
    }
    const startedAt = Date.now();
    const vector = await this.knowledge.embedQuery(request.message);

    // A custom answer that matches wins, as written, without the model (M3-6).
    const custom = await this.knowledge.matchCustomAnswer(
      botId,
      request.message,
      vector,
    );
    if (custom) {
      const sources = [
        {
          title: custom.triggerQuestion,
          page: null,
          similarity: Math.round(custom.similarity * 100) / 100,
        },
      ];
      if (context.includeSources) emit({ type: 'sources', sources });
      if (!emit({ type: 'delta', text: custom.answer })) return;
      const conversationId = await this.store(botId, request, context, {
        content: custom.answer,
        sources,
        answeredBy: 'custom_answer',
        model: null,
        tokensIn: null,
        tokensOut: null,
        latencyMs: Date.now() - startedAt,
      });
      emit({ type: 'done', conversationId, answeredBy: 'custom_answer' });
      return;
    }

    const history = request.conversationId
      ? await this.conversations.recentTurns(
          {
            conversationId: request.conversationId,
            chatbotId: botId,
            visitorId: context.visitorId,
            isPreview: context.isPreview,
          },
          PREVIEW_CHAT_LIMITS.historyTurns,
        )
      : [];
    const matches = await this.knowledge.search(
      botId,
      request.message,
      undefined,
      true,
      vector,
    );
    const sources = matches.map(toSource);
    if (context.includeSources) emit({ type: 'sources', sources });

    // Grounding (M3-10): nothing relevant was found, so the server says so
    // itself instead of letting the model guess. Greetings and thanks still
    // go to the model: they need no knowledge.
    if (matches.length === 0 && !isSmallTalk(request.message)) {
      await this.sendFallback(botId, config, request, emit, context, startedAt);
      return;
    }

    const messages = buildPreviewMessages(
      config,
      matches,
      history,
      request.message,
    );

    let text = '';
    let model: string | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    try {
      for await (const event of this.llm.streamWith(credentials, messages)) {
        if (event.type === 'text') {
          text += event.text;
          // The client has gone: stop, and store nothing.
          if (!emit({ type: 'delta', text: event.text })) return;
        } else {
          void this.keys.markUsed(event.credentialId);
          model = event.model;
          tokensIn = event.usage?.inputTokens ?? null;
          tokensOut = event.usage?.outputTokens ?? null;
        }
      }
    } catch (err) {
      if (
        text === '' &&
        (err instanceof NoLlmCredentialsConfiguredError ||
          err instanceof AllLlmKeysExhaustedError)
      ) {
        this.logger.warn(`Chat without an answer: ${String(err)}`);
        unstored(
          err instanceof AllLlmKeysExhaustedError
            ? context.keysExhaustedReply
            : context.noCredentialsReply,
        );
        return;
      }
      // Mid-answer or unexpected: the caller turns this into an error event.
      throw err;
    }

    let answeredBy: AnsweredBy = 'llm';
    let reply = text.trim();
    if (!reply) {
      reply = config.behavior.fallbackMessage;
      answeredBy = 'fallback';
      emit({ type: 'delta', text: reply });
    } else if (reply === config.behavior.fallbackMessage) {
      // The model followed the rule and gave the fallback itself.
      answeredBy = 'fallback';
    }
    if (answeredBy === 'fallback') emitHandoff(config, emit);

    const conversationId = await this.store(botId, request, context, {
      content: reply,
      sources,
      answeredBy,
      model,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - startedAt,
    });
    emit({ type: 'done', conversationId, answeredBy });
  }

  /** The configured fallback, with the handoff, without calling the model. */
  private async sendFallback(
    botId: string,
    config: ChatbotConfig,
    request: PreviewChatRequest,
    emit: EmitChatEvent,
    context: AnswerContext,
    startedAt: number,
  ): Promise<void> {
    const reply = config.behavior.fallbackMessage;
    if (!emit({ type: 'delta', text: reply })) return;
    emitHandoff(config, emit);
    const conversationId = await this.store(botId, request, context, {
      content: reply,
      sources: [],
      answeredBy: 'fallback',
      model: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: Date.now() - startedAt,
    });
    emit({ type: 'done', conversationId, answeredBy: 'fallback' });
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

/** The "contact us" button after a fallback, if the company set one. */
function emitHandoff(config: ChatbotConfig, emit: EmitChatEvent): void {
  const { type, value, label } = config.behavior.handoff;
  if (type === 'none' || !value) return;
  emit({ type: 'handoff', kind: type, value, label });
}

function toSource(match: KnowledgeMatch): PreviewChatSource {
  return {
    title: match.metadata.title,
    page: match.metadata.page ?? null,
    similarity: Math.round(Number(match.similarity) * 100) / 100,
  };
}
