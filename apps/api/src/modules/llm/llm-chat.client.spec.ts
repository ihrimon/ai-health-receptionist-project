import { Test, TestingModule } from '@nestjs/testing';
import { LlmProvider } from '../../generated/prisma/client';
import {
  AllLlmKeysExhaustedError,
  LlmKeyManager,
  NoLlmCredentialsConfiguredError,
} from './llm-key-manager';
import { LlmChatClient, describeProviderError } from './llm-chat.client';
import { ProviderRegistry } from './providers/provider-registry';

function assistantMessage(content: string) {
  return { role: 'assistant' as const, content };
}

describe('LlmChatClient', () => {
  let client: LlmChatClient;
  let keyManager: {
    getCredentialCount: jest.Mock;
    getCurrentCredential: jest.Mock;
    rotateToNext: jest.Mock;
    recordUsage: jest.Mock;
  };
  let adapter: {
    complete: jest.Mock;
    stream: jest.Mock;
    isRetryableError: jest.Mock;
    getRateLimitHeaders: jest.Mock;
  };
  let providerRegistry: { get: jest.Mock };

  beforeEach(async () => {
    keyManager = {
      getCredentialCount: jest.fn(),
      getCurrentCredential: jest.fn(),
      rotateToNext: jest.fn(),
      recordUsage: jest.fn(),
    };
    adapter = {
      complete: jest.fn(),
      stream: jest.fn(),
      isRetryableError: jest.fn().mockReturnValue(false),
      getRateLimitHeaders: jest.fn(),
    };
    providerRegistry = { get: jest.fn().mockReturnValue(adapter) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmChatClient,
        { provide: LlmKeyManager, useValue: keyManager },
        { provide: ProviderRegistry, useValue: providerRegistry },
      ],
    }).compile();

    client = module.get<LlmChatClient>(LlmChatClient);
  });

  it('throws NoLlmCredentialsConfiguredError when Settings is empty', async () => {
    keyManager.getCredentialCount.mockResolvedValue(0);

    await expect(client.complete([])).rejects.toThrow(
      NoLlmCredentialsConfiguredError,
    );
    expect(providerRegistry.get).not.toHaveBeenCalled();
  });

  it("dispatches to the adapter matching the current credential's provider", async () => {
    keyManager.getCredentialCount.mockResolvedValue(1);
    keyManager.getCurrentCredential.mockResolvedValue({
      id: 'cred-1',
      provider: LlmProvider.anthropic,
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
    });
    adapter.complete.mockResolvedValue({
      message: assistantMessage('Hi there!'),
      rateLimitHeaders: undefined,
    });

    const result = await client.complete([{ role: 'user', content: 'hello' }]);

    expect(providerRegistry.get).toHaveBeenCalledWith(LlmProvider.anthropic);
    expect(adapter.complete).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toEqual(assistantMessage('Hi there!'));
    expect(keyManager.recordUsage).toHaveBeenCalledWith('cred-1', undefined);
  });

  it('forwards the given tools to the adapter', async () => {
    keyManager.getCredentialCount.mockResolvedValue(1);
    keyManager.getCurrentCredential.mockResolvedValue({
      id: 'cred-1',
      provider: LlmProvider.groq,
      apiKey: 'key-a',
      model: 'model-a',
    });
    adapter.complete.mockResolvedValue({ message: assistantMessage('ok') });
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'search_products',
          description: 'Search the catalog',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    await client.complete([], tools);

    expect(adapter.complete).toHaveBeenCalledWith(
      expect.objectContaining({ tools }),
    );
  });

  it('rotates to the next credential on a rate-limit error and retries', async () => {
    keyManager.getCredentialCount.mockResolvedValue(2);
    keyManager.getCurrentCredential
      .mockResolvedValueOnce({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: 'key-a',
        model: 'model-a',
      })
      .mockResolvedValueOnce({
        id: 'cred-2',
        provider: LlmProvider.groq,
        apiKey: 'key-b',
        model: 'model-b',
      });
    const rateLimitErr = new Error('429');
    adapter.complete
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce({ message: assistantMessage('ok now') });
    adapter.isRetryableError.mockReturnValue(true);
    adapter.getRateLimitHeaders.mockReturnValue(undefined);
    keyManager.rotateToNext.mockResolvedValue(true);

    const result = await client.complete([]);

    expect(result).toEqual(assistantMessage('ok now'));
    expect(keyManager.rotateToNext).toHaveBeenCalledTimes(1);
    expect(adapter.complete).toHaveBeenCalledTimes(2);
  });

  it('rotates past an invalid/revoked credential (auth error) instead of failing the whole turn', async () => {
    keyManager.getCredentialCount.mockResolvedValue(2);
    keyManager.getCurrentCredential
      .mockResolvedValueOnce({
        id: 'cred-bad',
        provider: LlmProvider.groq,
        apiKey: 'invalid-key',
        model: 'model-a',
      })
      .mockResolvedValueOnce({
        id: 'cred-good',
        provider: LlmProvider.groq,
        apiKey: 'good-key',
        model: 'model-a',
      });
    const authErr = new Error('401 Invalid API Key');
    adapter.complete
      .mockRejectedValueOnce(authErr)
      .mockResolvedValueOnce({ message: assistantMessage('ok now') });
    adapter.isRetryableError.mockReturnValue(true);
    keyManager.rotateToNext.mockResolvedValue(true);

    const result = await client.complete([]);

    expect(result).toEqual(assistantMessage('ok now'));
    expect(keyManager.rotateToNext).toHaveBeenCalledTimes(1);
  });

  it('throws AllLlmKeysExhaustedError when rotation has nowhere left to go', async () => {
    keyManager.getCredentialCount.mockResolvedValue(1);
    keyManager.getCurrentCredential.mockResolvedValue({
      id: 'cred-1',
      provider: LlmProvider.groq,
      apiKey: 'key-a',
      model: 'model-a',
    });
    adapter.complete.mockRejectedValue(new Error('429'));
    adapter.isRetryableError.mockReturnValue(true);
    keyManager.rotateToNext.mockResolvedValue(false);

    await expect(client.complete([])).rejects.toThrow(AllLlmKeysExhaustedError);
  });

  it('does not retry a non-rate-limit error across credentials', async () => {
    keyManager.getCredentialCount.mockResolvedValue(2);
    keyManager.getCurrentCredential.mockResolvedValue({
      id: 'cred-1',
      provider: LlmProvider.groq,
      apiKey: 'key-a',
      model: 'model-a',
    });
    const badRequestErr = new Error('bad request');
    adapter.complete.mockRejectedValue(badRequestErr);
    adapter.isRetryableError.mockReturnValue(false);

    await expect(client.complete([])).rejects.toThrow(badRequestErr);
    expect(keyManager.rotateToNext).not.toHaveBeenCalled();
  });

  describe('completeWith (workspace keys, M3-21)', () => {
    const keys = [
      { id: 'k1', provider: LlmProvider.openai, apiKey: 'sk-1', model: 'm1' },
      { id: 'k2', provider: LlmProvider.groq, apiKey: 'gsk-2', model: 'm2' },
    ];

    it('throws NoLlmCredentialsConfiguredError with no keys, never touching the platform keys', async () => {
      await expect(client.completeWith([], [])).rejects.toThrow(
        NoLlmCredentialsConfiguredError,
      );
      expect(keyManager.getCurrentCredential).not.toHaveBeenCalled();
      expect(adapter.complete).not.toHaveBeenCalled();
    });

    it('moves to the next key after a retryable error and says which answered', async () => {
      const rateLimited = new Error('429');
      adapter.isRetryableError.mockImplementation((e) => e === rateLimited);
      adapter.complete
        .mockRejectedValueOnce(rateLimited)
        .mockResolvedValueOnce({
          message: assistantMessage('ok'),
          usage: { inputTokens: 10, outputTokens: 2 },
        });

      const result = await client.completeWith(keys, []);

      expect(result).toEqual({
        message: assistantMessage('ok'),
        credentialId: 'k2',
        model: 'm2',
        usage: { inputTokens: 10, outputTokens: 2 },
      });
      expect(adapter.complete).toHaveBeenLastCalledWith(
        expect.objectContaining({ apiKey: 'gsk-2', model: 'm2' }),
      );
    });

    it('throws AllLlmKeysExhaustedError when every key fails retryably', async () => {
      adapter.isRetryableError.mockReturnValue(true);
      adapter.complete.mockRejectedValue(new Error('401'));

      await expect(client.completeWith(keys, [])).rejects.toThrow(
        AllLlmKeysExhaustedError,
      );
      expect(adapter.complete).toHaveBeenCalledTimes(2);
    });

    it('does not try other keys after a non-retryable error', async () => {
      const bad = new Error('400 bad request');
      adapter.complete.mockRejectedValue(bad);

      await expect(client.completeWith(keys, [])).rejects.toThrow(bad);
      expect(adapter.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('verify', () => {
    const key = { provider: LlmProvider.gemini, apiKey: 'AIza', model: 'g' };

    it('passes when the provider answers', async () => {
      adapter.complete.mockResolvedValue({ message: assistantMessage('') });
      await expect(client.verify(key)).resolves.toBeUndefined();
    });

    it("is a 400 with the provider's reason when it refuses", async () => {
      adapter.complete.mockRejectedValue(new Error('API key not valid'));
      await expect(client.verify(key)).rejects.toThrow(
        /gemini key .*API key not valid/,
      );
    });
  });

  describe('streamWith', () => {
    const credentials = [
      { id: 'k1', provider: LlmProvider.openai, apiKey: 'a', model: 'm' },
      { id: 'k2', provider: LlmProvider.groq, apiKey: 'b', model: 'm' },
    ];

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* events(
      items: unknown[],
      failWith?: Error,
    ): AsyncGenerator<unknown> {
      for (const item of items) yield item;
      if (failWith) throw failWith;
    }

    async function collect(stream: AsyncIterable<unknown>) {
      const out: unknown[] = [];
      for await (const event of stream) out.push(event);
      return out;
    }

    it('yields text then done with the answering credential', async () => {
      adapter.stream.mockReturnValue(
        events([
          { type: 'text', text: 'Hi' },
          { type: 'done', message: assistantMessage('Hi') },
        ]),
      );

      const out = await collect(client.streamWith(credentials, []));

      expect(out).toEqual([
        { type: 'text', text: 'Hi' },
        {
          type: 'done',
          message: assistantMessage('Hi'),
          credentialId: 'k1',
          model: 'm',
        },
      ]);
    });

    it('moves to the next credential when the first fails before any text', async () => {
      adapter.isRetryableError.mockReturnValue(true);
      adapter.stream
        .mockReturnValueOnce(events([], new Error('429')))
        .mockReturnValueOnce(
          events([{ type: 'done', message: assistantMessage('ok') }]),
        );

      const out = await collect(client.streamWith(credentials, []));

      expect(out).toEqual([
        {
          type: 'done',
          message: assistantMessage('ok'),
          credentialId: 'k2',
          model: 'm',
        },
      ]);
    });

    it('does not switch credential once text has been yielded', async () => {
      adapter.isRetryableError.mockReturnValue(true);
      adapter.stream.mockReturnValueOnce(
        events([{ type: 'text', text: 'Par' }], new Error('dropped')),
      );

      await expect(collect(client.streamWith(credentials, []))).rejects.toThrow(
        'dropped',
      );
      expect(adapter.stream).toHaveBeenCalledTimes(1);
    });

    it('throws AllLlmKeysExhaustedError when every credential fails', async () => {
      adapter.isRetryableError.mockReturnValue(true);
      adapter.stream.mockImplementation(() => events([], new Error('429')));

      await expect(collect(client.streamWith(credentials, []))).rejects.toThrow(
        AllLlmKeysExhaustedError,
      );
    });

    it('throws NoLlmCredentialsConfiguredError with no credentials', async () => {
      await expect(collect(client.streamWith([], []))).rejects.toThrow(
        NoLlmCredentialsConfiguredError,
      );
    });
  });
});

describe('describeProviderError', () => {
  it('keeps only the error kind and status, never the message', () => {
    const err = Object.assign(new Error('Incorrect API key: sk-secret-123'), {
      name: 'AuthenticationError',
      status: 401,
    });
    const text = describeProviderError(err);
    expect(text).toBe('AuthenticationError (status 401)');
    expect(text).not.toContain('sk-secret');
  });

  it('handles errors without a status and non-error values', () => {
    expect(describeProviderError(new TypeError('boom sk-x'))).toBe('TypeError');
    expect(describeProviderError('sk-leaky')).toBe('Error');
    expect(describeProviderError(null)).toBe('Error');
  });
});
