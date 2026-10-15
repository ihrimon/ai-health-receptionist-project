import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  RateLimitError,
} from 'openai';
import type {
  ChatCompletionMessageParam as OpenAiMessageParam,
  ChatCompletionTool as OpenAiTool,
} from 'openai/resources/chat/completions';
import { readOpenAiStream } from './openai-stream';
import {
  LLM_REQUEST_TIMEOUT_MS,
  type AdapterCompleteParams,
  type AdapterCompleteResult,
  type AdapterStreamEvent,
  type LlmProviderAdapter,
} from './provider-adapter.types';

/**
 * For any provider that speaks the REAL OpenAI chat-completions REST
 * convention — `POST {baseURL}/chat/completions` — namely OpenAI itself
 * and OpenAI-compatible aggregators like OpenRouter and UnoRouter.
 *
 * Deliberately NOT `groq-sdk` with a `baseURL` override (that was this
 * project's earlier approach, see git history): `groq-sdk` hardcodes
 * Groq's own idiosyncratic resource path,
 * `/openai/v1/chat/completions`, in every request regardless of
 * `baseURL` — that only happens to produce the right URL because it's
 * also Groq's actual API shape (`https://api.groq.com` + that path).
 * Pointing `groq-sdk` at a different host via `baseURL` silently builds
 * a broken double-nested URL instead (confirmed empirically: UnoRouter
 * rejected a credential-validation call with
 * `Invalid URL (POST /v1/openai/v1/chat/completions)`). The real
 * `openai` package this class uses appends the standard
 * `/chat/completions` suffix with no hidden prefix, which is what every
 * other OpenAI-compatible provider actually expects — confirmed against
 * OpenRouter's and UnoRouter's own quickstart docs.
 *
 * Our canonical message/tool types (see provider-adapter.types.ts) are
 * typed against `groq-sdk`'s shape, not this package's — both implement
 * the same OpenAI chat-completions spec, so the casts at the boundaries
 * below are type-level only, not value conversions.
 */
export class OpenAiSdkAdapter implements LlmProviderAdapter {
  constructor(private readonly baseURL?: string) {}

  async complete({
    apiKey,
    model,
    messages,
    tools,
  }: AdapterCompleteParams): Promise<AdapterCompleteResult> {
    // maxRetries: 0 — see OpenAiCompatibleAdapter's identical note; our
    // own cross-credential rotation already covers retrying, and the
    // `openai` package's default 10-minute timeout is fatal for chat UX
    // if left unset (this is a free-tier aggregator under load, easily).
    const client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const { data: completion, response } = await client.chat.completions
      .create({
        model,
        messages: messages as unknown as OpenAiMessageParam[],
        ...(tools?.length
          ? {
              tools: tools as unknown as OpenAiTool[],
              tool_choice: 'auto' as const,
            }
          : {}),
        max_tokens: 1024,
      })
      .withResponse();

    return {
      message: (completion.choices[0]
        ?.message as unknown as AdapterCompleteResult['message']) ?? {
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
    const client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model,
      messages: messages as unknown as OpenAiMessageParam[],
      ...(tools?.length
        ? {
            tools: tools as unknown as OpenAiTool[],
            tool_choice: 'auto' as const,
          }
        : {}),
      max_tokens: 1024,
      stream: true,
      stream_options: { include_usage: true },
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
    // Same cross-platform Headers-typing note as OpenAiCompatibleAdapter.
    return err instanceof RateLimitError
      ? (err.headers as unknown as AdapterCompleteResult['rateLimitHeaders'])
      : undefined;
  }
}
