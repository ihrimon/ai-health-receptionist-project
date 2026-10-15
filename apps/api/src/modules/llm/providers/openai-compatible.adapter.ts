import Groq, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  RateLimitError,
} from 'groq-sdk';
import { readOpenAiStream } from './openai-stream';
import {
  LLM_REQUEST_TIMEOUT_MS,
  type AdapterCompleteParams,
  type AdapterCompleteResult,
  type AdapterStreamEvent,
  type LlmProviderAdapter,
} from './provider-adapter.types';

/**
 * Groq only — `groq-sdk` hardcodes Groq's own idiosyncratic resource
 * path (`/openai/v1/chat/completions`) in every request, which only
 * produces a correct URL against Groq's actual endpoint
 * (`https://api.groq.com`, the SDK's default when `apiKey` alone is
 * passed here). It is NOT a general-purpose "point this at any
 * OpenAI-compatible host via baseURL" client — an earlier version of
 * this adapter assumed it was and passed a `baseURL` override for
 * OpenAI/OpenRouter/UnoRouter too, which silently built a broken
 * double-nested URL for every one of them (confirmed empirically:
 * `Invalid URL (POST /v1/openai/v1/chat/completions)`). Those providers
 * use OpenAiSdkAdapter (the real `openai` package) instead — see its
 * doc comment.
 */
export class OpenAiCompatibleAdapter implements LlmProviderAdapter {
  async complete({
    apiKey,
    model,
    messages,
    tools,
  }: AdapterCompleteParams): Promise<AdapterCompleteResult> {
    // maxRetries: 0 — LlmChatClient already retries across every OTHER
    // configured credential; the SDK's own default of retrying the SAME
    // key twice (with backoff) just adds delay for no real benefit here.
    const client = new Groq({
      apiKey,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const { data: completion, response } = await client.chat.completions
      .create({
        model,
        messages,
        ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: 1024,
      })
      .withResponse();

    return {
      message: completion.choices[0]?.message ?? {
        role: 'assistant',
        content: '',
      },
      rateLimitHeaders: response.headers,
    };
  }

  async *stream({
    apiKey,
    model,
    messages,
    tools,
  }: AdapterCompleteParams): AsyncGenerator<AdapterStreamEvent> {
    const client = new Groq({
      apiKey,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model,
      messages,
      ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
      max_tokens: 1024,
      stream: true,
    });
    yield* readOpenAiStream(completion);
  }

  isRetryableError(err: unknown): boolean {
    return (
      err instanceof RateLimitError ||
      err instanceof AuthenticationError ||
      err instanceof APIConnectionTimeoutError ||
      err instanceof APIConnectionError
    );
  }

  getRateLimitHeaders(err: unknown) {
    // groq-sdk types err.headers via a cross-platform "SelectType"
    // conditional TS can't statically resolve to a concrete Headers-like
    // shape here — at runtime it's the same fetch Headers object as a
    // successful response's headers.
    return err instanceof RateLimitError
      ? (err.headers as unknown as AdapterCompleteResult['rateLimitHeaders'])
      : undefined;
  }
}
