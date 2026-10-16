import {
  type ChatbotConfig,
  PREVIEW_CHAT_LIMITS,
  type PreviewChatRequest,
  type PreviewChatSource,
} from '@brainstack/shared';
import { Injectable, Logger } from '@nestjs/common';
import { sameText } from '../../common/same-text';
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
import { UsageService } from '../usage/usage.service';
import type { ChatCompletionMessageParam } from '../llm/providers/provider-adapter.types';
import { PRODUCT_TOOLS, ProductToolsService } from './product-tools.service';
import { buildPreviewMessages } from './preview-prompt';
import { isSmallTalk } from './small-talk';

/** How many times the model may call tools before it has to answer (M3-8). */
const MAX_TOOL_ROUNDS = 3;

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
    private readonly products: ProductToolsService,
    private readonly usage: UsageService,
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
    // go to the model: they need no knowledge. A chatbot with products goes
    // on: the answer may come from the product tools (M3-8).
    const smallTalk = isSmallTalk(request.message);
    const hasProducts = await this.products.hasProducts(botId);
    if (matches.length === 0 && !smallTalk && !hasProducts) {
      await this.sendFallback(botId, config, request, emit, context, startedAt);
      return;
    }
    // With no knowledge match the text is held back until a tool has
    // returned a product; without one it is replaced by the fallback.
    const needsToolData = matches.length === 0 && !smallTalk;

    const messages = buildPreviewMessages(
      config,
      matches,
      history,
      request.message,
      hasProducts,
    );

    let text = '';
    let streamed = false;
    let model: string | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    const productHits = new Map<string, string>();
    try {
      for (let round = 0; ; round++) {
        // The last round has no tools, so the model has to answer.
        const tools =
          hasProducts && round < MAX_TOOL_ROUNDS ? PRODUCT_TOOLS : undefined;
        let roundText = '';
        let toolCalls: NonNullable<
          Extract<
            ChatCompletionMessageParam,
            { role: 'assistant' }
          >['tool_calls']
        > = [];
        for await (const event of this.llm.streamWith(
          credentials,
          messages,
          tools,
        )) {
          if (event.type === 'text') {
            roundText += event.text;
            // Held back only until a tool has found a product: from then
            // on the answer is grounded, so it streams like any other.
            if (!needsToolData || productHits.size > 0) {
              streamed = true;
              text += event.text;
              // The client has gone: stop, and store nothing.
              if (!emit({ type: 'delta', text: event.text })) return;
            }
          } else {
            void this.keys.markUsed(event.credentialId);
            model = event.model;
            if (event.usage) {
              tokensIn = (tokensIn ?? 0) + event.usage.inputTokens;
              tokensOut = (tokensOut ?? 0) + event.usage.outputTokens;
            }
            toolCalls = event.message.tool_calls ?? [];
          }
        }

        if (toolCalls.length === 0) {
          if (needsToolData && !streamed) text = roundText;
          break;
        }
        messages.push({
          role: 'assistant',
          content: roundText || null,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const run = await this.products.run(
            botId,
            call.function.name,
            call.function.arguments,
          );
          for (const product of run.products) {
            productHits.set(product.id, product.name);
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: run.content,
          });
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

    // No knowledge and no product found: nothing grounds the text, so the
    // server's fallback replaces whatever the model wrote.
    if (needsToolData) {
      if (productHits.size === 0) {
        await this.sendFallback(
          botId,
          config,
          request,
          emit,
          context,
          startedAt,
        );
        return;
      }
      if (!streamed && !emit({ type: 'delta', text })) return;
    }

    // Products the answer drew on count as sources too (M3-14).
    const answerSources = [
      ...sources,
      ...[...productHits.values()].map((name) => ({
        title: `Product: ${name}`,
        page: null,
        similarity: 1,
      })),
    ];
    if (productHits.size > 0 && context.includeSources) {
      emit({ type: 'sources', sources: answerSources });
    }

    let answeredBy: AnsweredBy = 'llm';
    let reply = text.trim();
    if (!reply) {
      reply = config.behavior.fallbackMessage;
      answeredBy = 'fallback';
      emit({ type: 'delta', text: reply });
    } else if (sameText(reply, config.behavior.fallbackMessage)) {
      // The model followed the rule and gave the fallback itself.
      answeredBy = 'fallback';
    }
    if (answeredBy === 'fallback') emitHandoff(config, emit);

    const conversationId = await this.store(botId, request, context, {
      content: reply,
      sources: answerSources,
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
    let conversationId: string;
    try {
      conversationId = await this.conversations.recordTurn({
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
    // Counting never costs the visitor an answer.
    try {
      await this.usage.record({
        preview: context.isPreview,
        tokensIn: answer.tokensIn ?? 0,
        tokensOut: answer.tokensOut ?? 0,
      });
    } catch (err) {
      this.logger.error(`Could not count the chat turn: ${String(err)}`);
    }
    return conversationId;
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
