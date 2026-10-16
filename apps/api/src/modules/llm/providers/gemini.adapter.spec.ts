import {
  toGeminiContents,
  toGeminiSchema,
  toGeminiTools,
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
