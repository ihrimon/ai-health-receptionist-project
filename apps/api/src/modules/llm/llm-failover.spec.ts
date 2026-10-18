import { LlmProvider } from '../../generated/prisma/client';
import { LlmChatClient } from './llm-chat.client';
import {
  AllLlmKeysExhaustedError,
  type LlmCredentialSnapshot,
  type LlmKeyManager,
} from './llm-key-manager';
import type {
  AdapterCompleteParams,
  AdapterCompleteResult,
  AdapterStreamEvent,
  LlmProviderAdapter,
} from './providers/provider-adapter.types';
import type { ProviderRegistry } from './providers/provider-registry';

/** M7-8: failover across providers, with fake adapters and fake keys only. */

class RateLimitError extends Error {}
class BadRequestError extends Error {}

const SECRET_A = 'sk-primary-SECRET';
const SECRET_B = 'sk-fallback-SECRET';

/** Fake provider: fails with `error` when given, else answers with `reply`. */
class FakeAdapter implements LlmProviderAdapter {
  readonly seenKeys: string[] = [];
  constructor(
    private readonly reply: string,
    private readonly error?: Error,
    private readonly textBeforeError?: string,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async complete(p: AdapterCompleteParams): Promise<AdapterCompleteResult> {
    this.seenKeys.push(p.apiKey);
    if (this.error) throw this.error;
    return { message: { role: 'assistant', content: this.reply } };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(p: AdapterCompleteParams): AsyncGenerator<AdapterStreamEvent> {
    this.seenKeys.push(p.apiKey);
    if (this.textBeforeError) {
      yield { type: 'text', text: this.textBeforeError };
    }
    if (this.error) throw this.error;
    yield { type: 'text', text: this.reply };
    yield { type: 'done', message: { role: 'assistant', content: this.reply } };
  }

  isRetryableError(err: unknown): boolean {
    return err instanceof RateLimitError;
  }

  getRateLimitHeaders(): undefined {
    return undefined;
  }
}

const primary: LlmCredentialSnapshot = {
  id: 'primary',
  provider: LlmProvider.openai,
  apiKey: SECRET_A,
  model: 'm-a',
};
const fallback: LlmCredentialSnapshot = {
  id: 'fallback',
  provider: LlmProvider.anthropic,
  apiKey: SECRET_B,
  model: 'm-b',
};

function makeClient(adapters: Partial<Record<LlmProvider, FakeAdapter>>) {
  const registry = {
    get: (provider: LlmProvider) => adapters[provider],
  } as unknown as ProviderRegistry;
  return new LlmChatClient({} as LlmKeyManager, registry);
}

async function collect(stream: AsyncIterable<unknown>) {
  const out: unknown[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('LLM provider failover (M7-8)', () => {
  it('uses the fallback provider when the primary is rate limited', async () => {
    const a = new FakeAdapter('', new RateLimitError('429'));
    const b = new FakeAdapter('from fallback');
    const client = makeClient({ openai: a, anthropic: b });

    const result = await client.completeWith([primary, fallback], []);

    expect(result.message.content).toBe('from fallback');
    expect(result.credentialId).toBe('fallback');
    expect(result.model).toBe('m-b');
    expect(a.seenKeys).toEqual([SECRET_A]);
    expect(b.seenKeys).toEqual([SECRET_B]);
  });

  it('does not touch the fallback when the primary answers', async () => {
    const a = new FakeAdapter('from primary');
    const b = new FakeAdapter('from fallback');
    const client = makeClient({ openai: a, anthropic: b });

    const result = await client.completeWith([primary, fallback], []);

    expect(result.credentialId).toBe('primary');
    expect(b.seenKeys).toEqual([]);
  });

  it('ends in a clean AllLlmKeysExhaustedError that leaks no key or provider text', async () => {
    const a = new FakeAdapter('', new RateLimitError(`429 for ${SECRET_A}`));
    const b = new FakeAdapter('', new RateLimitError(`401 for ${SECRET_B}`));
    const client = makeClient({ openai: a, anthropic: b });

    const err = await client
      .completeWith([primary, fallback], [])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AllLlmKeysExhaustedError);
    const text = String((err as Error).message) + JSON.stringify(err);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('429');
  });

  it('does not fail over on a non-retryable error (our own bad request)', async () => {
    const a = new FakeAdapter('', new BadRequestError('400 bad'));
    const b = new FakeAdapter('from fallback');
    const client = makeClient({ openai: a, anthropic: b });

    await expect(client.completeWith([primary, fallback], [])).rejects.toThrow(
      BadRequestError,
    );
    expect(b.seenKeys).toEqual([]);
  });

  it('never sends one credential key to another credential provider', async () => {
    const a = new FakeAdapter('', new RateLimitError('429'));
    const b = new FakeAdapter('ok');
    await makeClient({ openai: a, anthropic: b }).completeWith(
      [primary, fallback],
      [],
    );
    expect(a.seenKeys).not.toContain(SECRET_B);
    expect(b.seenKeys).not.toContain(SECRET_A);
  });

  describe('streaming', () => {
    it('fails over before any text and yields only the fallback answer', async () => {
      const a = new FakeAdapter('', new RateLimitError('429'));
      const b = new FakeAdapter('hello');
      const out = await collect(
        makeClient({ openai: a, anthropic: b }).streamWith(
          [primary, fallback],
          [],
        ),
      );
      expect(out).toEqual([
        { type: 'text', text: 'hello' },
        {
          type: 'done',
          message: { role: 'assistant', content: 'hello' },
          credentialId: 'fallback',
          model: 'm-b',
        },
      ]);
    });

    it('does not splice a second answer after text already went out', async () => {
      const a = new FakeAdapter('', new RateLimitError('dropped'), 'Par');
      const b = new FakeAdapter('hello');
      const seen: unknown[] = [];
      const run = (async () => {
        for await (const e of makeClient({
          openai: a,
          anthropic: b,
        }).streamWith([primary, fallback], [])) {
          seen.push(e);
        }
      })();

      await expect(run).rejects.toThrow('dropped');
      expect(seen).toEqual([{ type: 'text', text: 'Par' }]);
      expect(b.seenKeys).toEqual([]);
    });

    it('ends in AllLlmKeysExhaustedError when every provider fails', async () => {
      const a = new FakeAdapter('', new RateLimitError('429'));
      const b = new FakeAdapter('', new RateLimitError('429'));
      await expect(
        collect(
          makeClient({ openai: a, anthropic: b }).streamWith(
            [primary, fallback],
            [],
          ),
        ),
      ).rejects.toThrow(AllLlmKeysExhaustedError);
    });
  });
});
