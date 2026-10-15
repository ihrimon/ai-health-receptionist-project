import { toAnthropicTools } from './anthropic.adapter';

describe('toAnthropicTools', () => {
  it('maps an OpenAI-shape function tool to an Anthropic tool', () => {
    const parameters = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    };

    const tools = toAnthropicTools([
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
        name: 'search_products',
        description: 'Search the catalog',
        input_schema: parameters,
      },
    ]);
  });
});
