import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions';
import type { HeaderReader } from '../llm-key-manager';

/**
 * Canonical, provider-agnostic message/output shape used everywhere in
 * this codebase OUTSIDE the adapters themselves (ChatService's tool loop,
 * LlmChatClient's buildMessages) — it's the OpenAI/Groq chat-completions
 * shape, chosen as the shared format because it's what this project
 * started with, not because any one provider is "the standard". Each
 * adapter's whole job is translating this shape to/from its own
 * provider's native API shape, so the rest of the app never has to know
 * which provider actually answered a given turn.
 */
export type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
};

/**
 * Every provider SDK here defaults to a very generous per-request
 * timeout (groq-sdk: 1 minute; the `openai` package and
 * `@anthropic-ai/sdk`: 10 minutes) — fine for a one-off script, but
 * fatal for chat UX when a slow/overloaded credential (a free-tier
 * aggregator under load, say) is in the rotation: LlmChatClient's
 * cross-credential retry can't kick in until the SDK itself gives up,
 * so one bad credential could make a single chat turn take minutes.
 * Each adapter passes this explicitly instead, so a genuinely slow or
 * hung provider fails fast enough to rotate to the next credential
 * within the same turn rather than the caller just waiting.
 */
export const LLM_REQUEST_TIMEOUT_MS = 20_000;

export interface AdapterCompleteParams {
  apiKey: string;
  model: string;
  messages: ChatCompletionMessageParam[];
  /**
   * Tools the model may call this turn, in our canonical OpenAI shape —
   * each adapter translates them to its provider's format. Omitted or
   * empty means a plain text completion: adapters must then leave the
   * provider's tools field out entirely, since some APIs reject an empty
   * tools array.
   */
  tools?: ChatCompletionTool[];
}

export interface AdapterCompleteResult {
  message: ChatCompletionMessage;
  /** Rate-limit response headers, if this provider's SDK exposes them — used for the Settings usage display. Not every provider does. */
  rateLimitHeaders?: HeaderReader;
}

export interface LlmProviderAdapter {
  complete(params: AdapterCompleteParams): Promise<AdapterCompleteResult>;
  /**
   * Whether a thrown error is worth rotating to the next configured
   * credential for, rather than failing the turn outright — a rate limit
   * (429) obviously, but ALSO an authentication error (401/403, a
   * revoked/mistyped key) and a connection timeout/network error: a
   * single bad OR slow/unreachable credential shouldn't block every
   * *other* configured credential behind it in the list from ever being
   * tried. A genuinely different problem (a malformed request our own
   * code sent) still isn't retried — another key wouldn't fix that.
   */
  isRetryableError(err: unknown): boolean;
  /** Rate-limit headers carried on the error, if this provider's SDK exposes them (used only after isRetryableError(err) is true; not every provider/error has them, e.g. an auth error usually doesn't carry quota info). */
  getRateLimitHeaders(err: unknown): HeaderReader | undefined;
}
