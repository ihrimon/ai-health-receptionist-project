import type {
  AdapterCompleteParams,
  AdapterCompleteResult,
  AdapterStreamEvent,
  LlmProviderAdapter,
} from './provider-adapter.types';

/** Every fake answer starts with this, so a load test can prove no real model answered. */
export const FAKE_LLM_MARKER = 'LOADTEST:';

export interface FakeLlmOptions {
  firstTokenMs: number;
  tokenMs: number;
  tokens: number;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * TEST ONLY (M7-5). Stands in for every real provider when LOAD_TEST_MODE is
 * on (see ProviderRegistry; the config refuses that flag in production). It
 * calls no network, answers with a canned text and waits the configured time
 * before the first token and between tokens, so latency numbers contain
 * everything of ours except the model.
 */
export class FakeLlmAdapter implements LlmProviderAdapter {
  constructor(private readonly options: FakeLlmOptions) {}

  async complete(
    params: AdapterCompleteParams,
  ): Promise<AdapterCompleteResult> {
    let content = '';
    for await (const event of this.stream(params)) {
      if (event.type === 'text') content += event.text;
    }
    return {
      message: { role: 'assistant', content },
      usage: { inputTokens: 100, outputTokens: this.options.tokens },
    };
  }

  async *stream(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the fake ignores its input
    _params: AdapterCompleteParams,
  ): AsyncGenerator<AdapterStreamEvent> {
    await sleep(this.options.firstTokenMs);
    let content = '';
    for (let i = 0; i < this.options.tokens; i++) {
      if (i > 0) await sleep(this.options.tokenMs);
      const text = i === 0 ? `${FAKE_LLM_MARKER} ` : `word${i} `;
      content += text;
      yield { type: 'text', text };
    }
    yield {
      type: 'done',
      message: { role: 'assistant', content },
      usage: { inputTokens: 100, outputTokens: this.options.tokens },
    };
  }

  isRetryableError(): boolean {
    return false;
  }

  getRateLimitHeaders(): undefined {
    return undefined;
  }
}
