import {
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Part,
  type Tool,
} from '@google/generative-ai';
import { randomUUID } from 'crypto';
import {
  LLM_REQUEST_TIMEOUT_MS,
  type AdapterCompleteParams,
  type AdapterCompleteResult,
  type ChatCompletionMessage,
  type ChatCompletionMessageParam,
  type ChatCompletionTool,
  type LlmProviderAdapter,
} from './provider-adapter.types';

// Our tool definitions are always `{ type: 'function', function: {...} }`
// literals (never any other Groq.ChatCompletionTool variant), so
// `function` is always present despite the SDK's general type marking it
// optional.
export function toGeminiTools(tools: ChatCompletionTool[]): Tool[] {
  const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
    name: tool.function!.name,
    description: tool.function!.description,
    // SchemaType's enum values ARE the plain lowercase JSON Schema type
    // strings ("object", "string", ...) our tool defs already use — this
    // is a type-level cast, not a value conversion.
    parameters: tool.function!
      .parameters as unknown as FunctionDeclarationSchema,
  }));
  return [{ functionDeclarations }];
}

/**
 * Gemini's API has its own shape — `contents` with role "user"/"model"
 * instead of "user"/"assistant", a separate `systemInstruction` instead
 * of a system-role message, function calls as `functionCall` parts
 * (unlike OpenAI/Anthropic, with no id of their own — synthesized here so
 * ChatService's tool loop still has something to correlate against), and
 * tool results as role "function" `functionResponse` parts. This adapter
 * translates our canonical OpenAI-shape messages to/from that.
 */
export class GeminiAdapter implements LlmProviderAdapter {
  async complete({
    apiKey,
    model,
    messages,
    tools,
  }: AdapterCompleteParams): Promise<AdapterCompleteResult> {
    const client = new GoogleGenerativeAI(apiKey);
    const { systemInstruction, contents } = toGeminiContents(messages);
    const generativeModel = client.getGenerativeModel({
      model,
      ...(tools?.length ? { tools: toGeminiTools(tools) } : {}),
      systemInstruction,
    });

    // Unlike the other three adapters, this SDK has no generous built-in
    // default to override — an unset timeout here means no timeout at
    // all, so this is the only thing standing between a hung request and
    // LlmChatClient's cross-credential rotation never getting a chance
    // to run within the same turn.
    const result = await generativeModel.generateContent(
      { contents },
      { timeout: LLM_REQUEST_TIMEOUT_MS },
    );

    return { message: fromGeminiResponse(result.response) };
  }

  isRetryableError(err: unknown): boolean {
    // Gemini reports an invalid API key as a 400 (not 401) — the message
    // body says so, but the SDK doesn't parse it into a distinct error
    // class the way Groq/Anthropic do, so status code is all we can key
    // off here. 403 covers a key that's valid but lacks access to the
    // requested model, and 404 a model name that's wrong or has been
    // deprecated/retired by Google — both are per-credential
    // misconfigurations, not something wrong with the request itself, so
    // they shouldn't block every other configured credential either.
    if (err instanceof GoogleGenerativeAIFetchError) {
      return (
        err.status === 429 ||
        err.status === 400 ||
        err.status === 403 ||
        err.status === 404
      );
    }
    // Our own timeout (LLM_REQUEST_TIMEOUT_MS above) aborting the
    // request — a slow/unreachable credential shouldn't block every
    // other configured one either, same reasoning as the status checks
    // above.
    return err instanceof GoogleGenerativeAIAbortError;
  }

  getRateLimitHeaders(): undefined {
    // The Gemini SDK doesn't expose response headers on its errors — the
    // rotation logic still works fine (a 429 still triggers rotation),
    // just without a usage snapshot for the Settings page.
    return undefined;
  }
}

export function toGeminiContents(messages: ChatCompletionMessageParam[]): {
  systemInstruction: string;
  contents: Content[];
} {
  // Gemini's functionResponse part needs the function's *name*, but our
  // canonical "tool" role message only carries the tool_call_id — recover
  // the name from whichever earlier assistant tool_calls entry it
  // answers.
  const nameByToolCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        nameByToolCallId.set(call.id, call.function.name);
      }
    }
  }

  const systemParts: string[] = [];
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (typeof message.content === 'string')
        systemParts.push(message.content);
      continue;
    }

    if (message.role === 'user') {
      contents.push({
        role: 'user',
        parts: [
          { text: typeof message.content === 'string' ? message.content : '' },
        ],
      });
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls = message.tool_calls ?? [];
      const parts: Part[] = [];
      if (typeof message.content === 'string' && message.content) {
        parts.push({ text: message.content });
      }
      for (const call of toolCalls) {
        parts.push({
          functionCall: {
            name: call.function.name,
            args: safeJsonParse(call.function.arguments),
          },
        });
      }
      if (parts.length === 0) parts.push({ text: '' });
      contents.push({ role: 'model', parts });
      continue;
    }

    if (message.role === 'tool') {
      const name = nameByToolCallId.get(message.tool_call_id) ?? 'unknown';
      contents.push({
        // Not 'function' — the @google/generative-ai SDK's own type still
        // lists it as valid (POSSIBLE_ROLES), but the live API now
        // rejects it for gemini-3.6-flash with "Role 'function' is not
        // supported" (confirmed in production logs), meaning the actual
        // backend has moved past what this SDK's types describe. 'user'
        // is what the error's own accepted-roles list includes, and is
        // the conventional way to carry a function result back to the
        // model (as new information for the "user side" of the turn).
        role: 'user',
        parts: [
          {
            functionResponse: {
              name,
              response: safeJsonParse(
                typeof message.content === 'string' ? message.content : '{}',
              ),
            },
          },
        ],
      });
    }
  }

  return { systemInstruction: systemParts.join('\n\n'), contents };
}

function fromGeminiResponse(response: {
  text: () => string;
  functionCalls: () => { name: string; args: object }[] | undefined;
}): ChatCompletionMessage {
  const text = response.text();
  const calls = response.functionCalls() ?? [];

  return {
    role: 'assistant',
    content: text || null,
    ...(calls.length > 0
      ? {
          tool_calls: calls.map((call) => ({
            id: randomUUID(),
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args ?? {}),
            },
          })),
        }
      : {}),
  };
}

function safeJsonParse(json: string): object {
  try {
    return JSON.parse(json) as object;
  } catch {
    return {};
  }
}
