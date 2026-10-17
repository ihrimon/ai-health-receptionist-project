import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../../generated/prisma/client';
import { FAKE_LLM_MARKER, FakeLlmAdapter } from './fake-llm.adapter';
import type { AdapterStreamEvent } from './provider-adapter.types';
import { ProviderRegistry } from './provider-registry';

describe('FakeLlmAdapter (M7-5)', () => {
  const options = { firstTokenMs: 0, tokenMs: 0, tokens: 3 };

  it('streams marked text pieces then one done with usage', async () => {
    const events: AdapterStreamEvent[] = [];
    for await (const e of new FakeLlmAdapter(options).stream({
      apiKey: 'x',
      model: 'm',
      messages: [],
    })) {
      events.push(e);
    }
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ type: 'text', text: `${FAKE_LLM_MARKER} ` });
    expect(events[3]).toMatchObject({
      type: 'done',
      usage: { outputTokens: 3 },
    });
  });

  it('complete() returns the same text', async () => {
    const result = await new FakeLlmAdapter(options).complete({
      apiKey: 'x',
      model: 'm',
      messages: [],
    });
    expect(result.message.content).toBe(`${FAKE_LLM_MARKER} word1 word2 `);
  });
});

describe('ProviderRegistry in load-test mode (M7-5)', () => {
  const configWith = (loadTest: unknown) =>
    ({ get: () => loadTest }) as unknown as ConfigService;

  it('hands out the fake adapter for every provider only when enabled', () => {
    const on = new ProviderRegistry(
      configWith({
        enabled: true,
        fakeFirstTokenMs: 0,
        fakeTokenMs: 0,
        fakeTokens: 1,
      }),
    );
    expect(on.get(LlmProvider.openai)).toBeInstanceOf(FakeLlmAdapter);
    expect(on.get(LlmProvider.anthropic)).toBeInstanceOf(FakeLlmAdapter);

    for (const config of [configWith({ enabled: false }), undefined]) {
      expect(
        new ProviderRegistry(config).get(LlmProvider.openai),
      ).not.toBeInstanceOf(FakeLlmAdapter);
    }
  });
});
