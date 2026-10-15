import type {
  AdapterStreamEvent,
  ChatCompletionMessage,
  LlmUsage,
} from './provider-adapter.types';

/** The slice of an OpenAI-style chat-completions stream chunk we read (OpenAI, Groq and the aggregators share it). */
export interface OpenAiLikeChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  /** Groq reports usage here on its final chunk. */
  x_groq?: {
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  } | null;
}

/**
 * Turns an OpenAI-style chunk stream into our events: text pieces as they
 * come, then one `done` with the assembled message. Tool-call arguments
 * arrive in fragments keyed by `index` and are joined here.
 */
export async function* readOpenAiStream(
  chunks: AsyncIterable<OpenAiLikeChunk>,
): AsyncGenerator<AdapterStreamEvent> {
  let content = '';
  const toolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let usage: LlmUsage | undefined;

  for await (const chunk of chunks) {
    const reported = chunk.usage ?? chunk.x_groq?.usage;
    if (reported) {
      usage = {
        inputTokens: reported.prompt_tokens ?? 0,
        outputTokens: reported.completion_tokens ?? 0,
      };
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      yield { type: 'text', text: delta.content };
    }
    for (const call of delta.tool_calls ?? []) {
      const entry = toolCalls.get(call.index) ?? {
        id: '',
        name: '',
        arguments: '',
      };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.arguments += call.function.arguments;
      toolCalls.set(call.index, entry);
    }
  }

  const calls = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' },
    }));
  const message: ChatCompletionMessage = {
    role: 'assistant',
    content: content || null,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  };
  yield { type: 'done', message, usage };
}
