import { Test, TestingModule } from '@nestjs/testing';
import { LlmCredentialsService } from '../llm-credentials/llm-credentials.service';
import { LlmKeyManager } from './llm-key-manager';

function credential(apiKey: string, model = 'test-model') {
  return { id: apiKey, apiKey, model, sortOrder: 0, isActive: true } as never;
}

async function buildManager(
  credentials: ReturnType<typeof credential>[],
): Promise<{
  manager: LlmKeyManager;
  findActiveOrdered: jest.Mock;
  recordUsage: jest.Mock;
}> {
  const findActiveOrdered = jest.fn().mockResolvedValue(credentials);
  const recordUsage = jest.fn().mockResolvedValue(undefined);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LlmKeyManager,
      {
        provide: LlmCredentialsService,
        useValue: { findActiveOrdered, recordUsage },
      },
    ],
  }).compile();

  return {
    manager: module.get<LlmKeyManager>(LlmKeyManager),
    findActiveOrdered,
    recordUsage,
  };
}

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

describe('LlmKeyManager', () => {
  it('starts on the first configured credential', async () => {
    const { manager } = await buildManager([
      credential('key-a', 'model-a'),
      credential('key-b', 'model-b'),
    ]);

    await expect(manager.getCurrentCredential()).resolves.toEqual({
      id: 'key-a',
      apiKey: 'key-a',
      model: 'model-a',
    });
    await expect(manager.getCredentialCount()).resolves.toBe(2);
  });

  it('rotates forward through credentials in order', async () => {
    const { manager } = await buildManager([
      credential('key-a'),
      credential('key-b'),
      credential('key-c'),
    ]);

    await expect(manager.rotateToNext()).resolves.toBe(true);
    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-b',
    });

    await expect(manager.rotateToNext()).resolves.toBe(true);
    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-c',
    });
  });

  it('returns false once the last credential is exhausted, and stays on it', async () => {
    const { manager } = await buildManager([
      credential('key-a'),
      credential('key-b'),
    ]);

    await expect(manager.rotateToNext()).resolves.toBe(true);
    await expect(manager.rotateToNext()).resolves.toBe(false);
    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-b',
    });
  });

  it('returns undefined and a zero count when nothing is configured', async () => {
    const { manager } = await buildManager([]);

    await expect(manager.getCurrentCredential()).resolves.toBeUndefined();
    await expect(manager.getCredentialCount()).resolves.toBe(0);
    await expect(manager.rotateToNext()).resolves.toBe(false);
  });

  it('re-reads the credential list on every call, reflecting live Settings edits', async () => {
    const { manager, findActiveOrdered } = await buildManager([
      credential('key-a'),
    ]);

    await manager.getCurrentCredential();
    findActiveOrdered.mockResolvedValue([
      credential('key-a'),
      credential('key-b'),
    ]);
    await expect(manager.getCredentialCount()).resolves.toBe(2);
  });

  it('keeps pointing at the same credential after it moves position (reorder), not whatever now sits in the old slot', async () => {
    const { manager, findActiveOrdered } = await buildManager([
      credential('key-a'),
      credential('key-b'),
      credential('key-c'),
    ]);

    await manager.rotateToNext(); // now on key-b
    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-b',
    });

    // Admin reorders in Settings: key-c moved to the front. key-b is
    // still the second physical row, but was previously "index 1" —
    // an index-based tracker would have silently switched to whatever
    // is now at index 1 (key-a) instead.
    findActiveOrdered.mockResolvedValue([
      credential('key-c'),
      credential('key-b'),
      credential('key-a'),
    ]);

    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-b',
    });
  });

  it('falls back to the new first credential when the in-rotation one is deleted, instead of returning undefined', async () => {
    const { manager, findActiveOrdered } = await buildManager([
      credential('key-a'),
      credential('key-b'),
      credential('key-c'),
    ]);

    await manager.rotateToNext(); // now on key-b
    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-b',
    });

    // Admin deletes key-b (the in-rotation credential) in Settings.
    findActiveOrdered.mockResolvedValue([
      credential('key-a'),
      credential('key-c'),
    ]);

    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-a',
    });
  });

  it('rotates onward correctly after the in-rotation credential was deleted', async () => {
    const { manager, findActiveOrdered } = await buildManager([
      credential('key-a'),
      credential('key-b'),
      credential('key-c'),
    ]);

    await manager.rotateToNext(); // now on key-b
    findActiveOrdered.mockResolvedValue([
      credential('key-a'),
      credential('key-c'),
    ]); // key-b deleted

    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-a',
    }); // falls back to first
    await expect(manager.rotateToNext()).resolves.toBe(true);
    await expect(manager.getCurrentCredential()).resolves.toMatchObject({
      apiKey: 'key-c',
    });
  });

  describe('recordUsage', () => {
    it('parses the rate-limit headers and persists them against the credential', async () => {
      const { manager, recordUsage } = await buildManager([
        credential('key-a'),
      ]);

      await manager.recordUsage(
        'cred-1',
        headers({
          'x-ratelimit-limit-requests': '1000',
          'x-ratelimit-remaining-requests': '997',
          'x-ratelimit-reset-requests': '2s',
          'x-ratelimit-limit-tokens': '100000',
          'x-ratelimit-remaining-tokens': '99500',
          'x-ratelimit-reset-tokens': '300ms',
        }),
      );

      expect(recordUsage).toHaveBeenCalledWith('cred-1', {
        rlLimitRequests: 1000,
        rlRemainingRequests: 997,
        rlResetRequests: '2s',
        rlLimitTokens: 100000,
        rlRemainingTokens: 99500,
        rlResetTokens: '300ms',
      });
    });

    it('stores undefined for headers the provider did not send, instead of throwing', async () => {
      const { manager, recordUsage } = await buildManager([
        credential('key-a'),
      ]);

      await manager.recordUsage('cred-1', headers({}));

      expect(recordUsage).toHaveBeenCalledWith('cred-1', {
        rlLimitRequests: undefined,
        rlRemainingRequests: undefined,
        rlResetRequests: undefined,
        rlLimitTokens: undefined,
        rlRemainingTokens: undefined,
        rlResetTokens: undefined,
      });
    });

    it('swallows a persistence failure rather than throwing, so it never fails the chat turn', async () => {
      const { manager, recordUsage } = await buildManager([
        credential('key-a'),
      ]);
      recordUsage.mockRejectedValue(new Error('db unavailable'));

      await expect(
        manager.recordUsage('cred-1', headers({})),
      ).resolves.toBeUndefined();
    });
  });
});
