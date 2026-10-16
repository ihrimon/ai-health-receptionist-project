import { GoogleGenerativeAIFetchError } from '@google/generative-ai';
import {
  thinkingConfigFor,
  toGeminiContents,
  toGeminiSchema,
  toGeminiTools,
  withThinkingFallback,
} from './gemini.adapter';

describe('toGeminiContents', () => {
  it('sends a tool result back with role "user", not "function"', () => {
    // Confirmed live in production: Gemini's API rejects role "function"
    // for gemini-3.6-flash with "[400 Bad Request] Role 'function' is
    // not supported" — even though the @google/generative-ai SDK's own
    // types still list it as valid. This locks in the fix.
    const { contents } = toGeminiContents([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search_products', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ slots: [] }),
      },
    ]);

    const toolResultContent = contents.find((c) =>
      c.parts.some((p) => 'functionResponse' in p),
    );

    expect(toolResultContent?.role).toBe('user');
    expect(toolResultContent?.role).not.toBe('function');
  });

  it('recovers the function name from the matching earlier tool_call', () => {
    const { contents } = toGeminiContents([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search_products', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: '{}',
      },
    ]);

    const toolResultContent = contents.find((c) =>
      c.parts.some((p) => 'functionResponse' in p),
    );
    const part = toolResultContent?.parts.find(
      (p): p is { functionResponse: { name: string; response: object } } =>
        'functionResponse' in p,
    );

    expect(part?.functionResponse.name).toBe('search_products');
  });
});

describe('toGeminiTools', () => {
  it('wraps OpenAI-shape function tools in a single functionDeclarations entry', () => {
    const parameters = {
      type: 'object',
      properties: { query: { type: 'string' } },
    };

    const tools = toGeminiTools([
      {
        type: 'function',
        function: {
          name: 'search_products',
          description: 'Search the catalog',
          parameters,
        },
      },
    ]);

    expect(tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'search_products',
            description: 'Search the catalog',
            parameters,
          },
        ],
      },
    ]);
  });
});

describe('toGeminiSchema', () => {
  it('turns a type list with null into one type and nullable', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_price: { type: ['number', 'null'], description: 'x' },
        },
        required: ['query'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_price: { type: 'number', nullable: true, description: 'x' },
      },
      required: ['query'],
    });
  });

  it('leaves a plain schema alone', () => {
    const schema = { type: 'object', properties: { id: { type: 'string' } } };
    expect(toGeminiSchema(schema)).toEqual(schema);
  });
});

describe('thinkingConfigFor', () => {
  it.each([
    ['gemini-2.5-flash', { thinkingBudget: 0 }],
    ['gemini-2.5-flash-lite', { thinkingBudget: 0 }],
    ['gemini-3-flash-preview', { thinkingLevel: 'minimal' }],
    ['gemini-3.6-flash', { thinkingLevel: 'minimal' }],
  ])('turns thinking down for %s', (model, expected) => {
    expect(thinkingConfigFor(model)).toEqual(expected);
  });

  it.each(['gemini-2.5-pro', 'gemini-3-pro', 'gemini-1.5-flash'])(
    'leaves %s on its default',
    (model) => {
      expect(thinkingConfigFor(model)).toBeUndefined();
    },
  );
});

describe('withThinkingFallback', () => {
  const badRequest = () =>
    new GoogleGenerativeAIFetchError('Bad Request', 400, 'Bad Request');

  it('sends the thinking setting when the model takes it', async () => {
    const request = jest.fn().mockResolvedValue('ok');
    await expect(
      withThinkingFallback('gemini-2.5-flash', request),
    ).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ thinkingBudget: 0 });
  });

  it('asks again without it after a 400, and then stops sending it', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(badRequest())
      .mockResolvedValue('ok');
    await expect(
      withThinkingFallback('gemini-3.9-flash', request),
    ).resolves.toBe('ok');
    expect(request).toHaveBeenNthCalledWith(1, { thinkingLevel: 'minimal' });
    expect(request).toHaveBeenNthCalledWith(2, undefined);

    request.mockClear();
    await withThinkingFallback('gemini-3.9-flash', request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(undefined);
  });

  it('keeps the setting when the plain request fails too (a bad key)', async () => {
    const request = jest.fn().mockRejectedValue(badRequest());
    await expect(
      withThinkingFallback('gemini-3.8-flash', request),
    ).rejects.toThrow();
    request.mockReset().mockResolvedValue('ok');
    await withThinkingFallback('gemini-3.8-flash', request);
    expect(request).toHaveBeenCalledWith({ thinkingLevel: 'minimal' });
  });

  it('does not retry other errors', async () => {
    const request = jest
      .fn()
      .mockRejectedValue(new GoogleGenerativeAIFetchError('Too many', 429));
    await expect(
      withThinkingFallback('gemini-3.7-flash', request),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
