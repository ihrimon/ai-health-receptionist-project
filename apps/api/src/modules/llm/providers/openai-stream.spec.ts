import { readOpenAiStream, type OpenAiLikeChunk } from './openai-stream';
import type { AdapterStreamEvent } from './provider-adapter.types';

// eslint-disable-next-line @typescript-eslint/require-await
async function* chunksOf(
  ...chunks: OpenAiLikeChunk[]
): AsyncGenerator<OpenAiLikeChunk> {
  for (const chunk of chunks) yield chunk;
}

async function collect(
  stream: AsyncIterable<AdapterStreamEvent>,
): Promise<AdapterStreamEvent[]> {
  const events: AdapterStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('readOpenAiStream', () => {
  it('yields text pieces, then the joined message with usage', async () => {
    const events = await collect(
      readOpenAiStream(
        chunksOf(
          { choices: [{ delta: { content: 'Hel' } }] },
          { choices: [{ delta: { content: 'lo' } }] },
          {
            choices: [],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          },
        ),
      ),
    );

    expect(events).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      {
        type: 'done',
        message: { role: 'assistant', content: 'Hello' },
        usage: { inputTokens: 12, outputTokens: 3 },
      },
    ]);
  });

  it('joins tool-call argument fragments by index', async () => {
    const events = await collect(
      readOpenAiStream(
        chunksOf(
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: { name: 'search_products', arguments: '{"que' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: 'ry":"shoes"}' } },
                  ],
                },
              },
            ],
          },
        ),
      ),
    );

    expect(events).toEqual([
      {
        type: 'done',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_products',
                arguments: '{"query":"shoes"}',
              },
            },
          ],
        },
        usage: undefined,
      },
    ]);
  });

  it('reads Groq usage from x_groq on the last chunk', async () => {
    const events = await collect(
      readOpenAiStream(
        chunksOf({
          choices: [{ delta: { content: 'Hi' } }],
          x_groq: { usage: { prompt_tokens: 5, completion_tokens: 1 } },
        }),
      ),
    );

    expect(events[1]).toMatchObject({
      type: 'done',
      usage: { inputTokens: 5, outputTokens: 1 },
    });
  });
});
