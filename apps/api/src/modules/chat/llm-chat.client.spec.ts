import { Test, TestingModule } from '@nestjs/testing';
import { LlmProvider } from '../../generated/prisma/client';
import {
  AllLlmKeysExhaustedError,
  LlmKeyManager,
  NoLlmCredentialsConfiguredError,
} from './llm-key-manager';
import { LlmChatClient } from './llm-chat.client';
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
        .mockResolvedValueOnce({ message: assistantMessage('ok') });

      const result = await client.completeWith(keys, []);

      expect(result).toEqual({
        message: assistantMessage('ok'),
        credentialId: 'k2',
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
});
