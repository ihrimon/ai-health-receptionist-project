import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions';
import * as fs from 'fs';
import * as path from 'path';
import {
  AllLlmKeysExhaustedError,
  LlmKeyManager,
  NoLlmCredentialsConfiguredError,
} from './llm-key-manager';
import { ProviderRegistry } from './providers/provider-registry';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

/**
 * MVP substitute for the Claude integration named in docs/implementation.md
 * — uses the `groq-sdk` client (an OpenAI-compatible chat-completions
 * client), pointed at whichever API key + model the admin configured in
 * Settings (LlmKeyManager) rather than a fixed Groq key from .env. Named
 * "Llm", not "Groq", because it's no longer tied to Groq specifically —
 * any OpenAI-compatible-endpoint provider's key/model works the same way.
 */
@Injectable()
export class LlmChatClient {
  private readonly logger = new Logger(LlmChatClient.name);
  private systemInstruction?: string;

  constructor(
    private readonly keyManager: LlmKeyManager,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  /** Pure — builds the messages array for a turn, no API call. Extend this array with assistant/tool messages between complete() calls to run a tool loop. */
  buildMessages(
    history: ChatTurn[],
    referenceChunks: string[] = [],
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: this.getSystemInstruction() },
      { role: 'system', content: this.getTodayInstruction() },
    ];

    if (referenceChunks.length > 0) {
      messages.push({
        role: 'system',
        content:
          'Reference information about the business, for answering FAQ/policy questions. ' +
          'Use ONLY facts explicitly written below — never invent specific details ' +
          "(addresses, phone numbers, emails, prices, names, dates) that aren't stated here, " +
          "even if a plausible-sounding answer seems expected. If an entry says '[NOT YET PROVIDED]', " +
          "or the question isn't covered by any entry below, say plainly that you don't have that " +
          'information yet — do not guess or make up an answer:\n\n' +
          referenceChunks.map((chunk) => `- ${chunk}`).join('\n\n'),
      });
    }

    messages.push(
      ...history.map((turn): ChatCompletionMessageParam => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: turn.text,
      })),
    );

    return messages;
  }

  /**
   * One logical LLM API call, with `tools` registered if given (none =
   * plain text completion). Returns the raw assistant message (content +
   * tool_calls) — deliberately doesn't interpret which tool fired or
   * extract its args, since the caller owns any tool loop and must branch
   * on that itself.
   *
   * Transparently retries across the admin-configured credentials
   * (Settings page) on a rate limit OR an authentication error (see each
   * adapter's isRetryableError) — a mistyped/revoked key shouldn't block
   * every *other* configured credential behind it in the list any more
   * than a rate limit should. The caller never sees either kind of error
   * unless every credential is exhausted, in which case
   * AllLlmKeysExhaustedError is thrown so ChatService can reply with
   * something friendlier than a raw error. Any other error (bad request,
   * network, etc.) is NOT retried across credentials — another key
   * wouldn't fix those.
   */
  async complete(
    messages: ChatCompletionMessageParam[],
    tools?: ChatCompletionTool[],
  ): Promise<ChatCompletionMessage> {
    const totalCredentials = await this.keyManager.getCredentialCount();
    if (totalCredentials === 0) {
      throw new NoLlmCredentialsConfiguredError();
    }

    for (let attempt = 0; attempt < totalCredentials; attempt++) {
      const credential = await this.keyManager.getCurrentCredential();
      if (!credential) {
        throw new AllLlmKeysExhaustedError();
      }
      const adapter = this.providerRegistry.get(credential.provider);

      try {
        const result = await adapter.complete({
          apiKey: credential.apiKey,
          model: credential.model,
          messages,
          tools,
        });
        await this.keyManager.recordUsage(
          credential.id,
          result.rateLimitHeaders,
        );
        return result.message;
      } catch (err) {
        if (!adapter.isRetryableError(err)) {
          throw err;
        }
        // The real reason (429 rate limit, 401/403 auth, a timeout) —
        // rotateToNext()'s own log line just says "rate-limited" for all
        // three, which made this genuinely hard to diagnose from
        // production logs alone (is it actually a quota problem, or a
        // bad key, or a slow provider?).
        this.logger.warn(
          `Credential ${credential.id} (${credential.provider}, ${credential.model}) failed: ${(err as Error).message}`,
        );
        await this.keyManager.recordUsage(
          credential.id,
          adapter.getRateLimitHeaders(err),
        );
        if (!(await this.keyManager.rotateToNext())) {
          throw new AllLlmKeysExhaustedError();
        }
        // loop continues, retries with the newly-rotated credential
      }
    }

    throw new AllLlmKeysExhaustedError();
  }

  private getSystemInstruction(): string {
    if (!this.systemInstruction) {
      const promptPath = path.resolve(
        process.cwd(),
        '../../packages/ai/prompts/assistant.md',
      );
      this.systemInstruction = fs.readFileSync(promptPath, 'utf-8');
      this.logger.log(`Loaded assistant instructions from ${promptPath}`);
    }
    return this.systemInstruction;
  }

  /**
   * Computed fresh per turn (never cached, unlike getSystemInstruction) —
   * "today" changes daily. Without it the model has no grounding for the
   * current date and can silently assume a year from its training data
   * when a visitor asks about something time-relative.
   */
  private getTodayInstruction(): string {
    const today = new Date().toISOString().slice(0, 10);
    return `Today's date is ${today} (UTC). Use it for anything date-relative — never assume a different year.`;
  }
}
