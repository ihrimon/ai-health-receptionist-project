import {
  createLlmKeySchema,
  LLM_KEY_LIMITS,
  updateLlmKeySchema,
} from '@brainstack/shared';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SecretBox } from '../../common/secret-box';
import { WorkspaceRole } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { LlmChatClient } from '../llm/llm-chat.client';
import { LlmKeysService } from './llm-keys.service';

describe('LlmKeysService', () => {
  const secrets = new SecretBox(new ConfigService({ nodeEnv: 'test' }));
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'k1',
    workspaceId: 'ws-1',
    provider: 'openai',
    model: 'gpt-x',
    apiKeyEncrypted: secrets.encrypt('sk-secret-1234'),
    keyLast4: '1234',
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date('2026-10-15T00:00:00Z'),
    updatedAt: new Date('2026-10-15T00:00:00Z'),
    ...over,
  });
  const db = {
    workspaceLlmKey: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const llm = { verify: jest.fn() };
  let service: LlmKeysService;

  const inTenant = <T>(fn: () => Promise<T>) =>
    runWithTenant(
      { workspaceId: 'ws-1', userId: 'u', role: WorkspaceRole.OWNER },
      fn,
    );

  beforeEach(async () => {
    jest.resetAllMocks();
    db.workspaceLlmKey.count.mockResolvedValue(0);
    db.workspaceLlmKey.create.mockImplementation(({ data }) =>
      Promise.resolve(row(data as Record<string, unknown>)),
    );
    db.workspaceLlmKey.findUniqueOrThrow.mockResolvedValue(row());
    db.workspaceLlmKey.update.mockResolvedValue(row());
    llm.verify.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmKeysService,
        { provide: TENANT_PRISMA, useValue: db },
        { provide: SecretBox, useValue: secrets },
        { provide: LlmChatClient, useValue: llm },
      ],
    }).compile();
    service = moduleRef.get(LlmKeysService);
  });

  const input = {
    provider: 'openai',
    model: 'gpt-x',
    apiKey: 'sk-new-9876',
  } as const;

  it('verifies the key, stores it encrypted, and returns only its last 4', async () => {
    const view = await inTenant(() => service.create(input));

    expect(llm.verify).toHaveBeenCalledWith(input);
    const [[{ data }]] = db.workspaceLlmKey.create.mock.calls as [
      [{ data: { apiKeyEncrypted: string; workspaceId: string } }],
    ];
    expect(data.workspaceId).toBe('ws-1');
    expect(data.apiKeyEncrypted).not.toContain('sk-new');
    expect(secrets.decrypt(data.apiKeyEncrypted)).toBe('sk-new-9876');
    expect(view.keyLast4).toBe('9876');
    expect(JSON.stringify(view)).not.toContain('sk-new');
  });

  it('saves nothing when the provider rejects the key', async () => {
    llm.verify.mockRejectedValue(new BadRequestException('bad key'));
    await expect(inTenant(() => service.create(input))).rejects.toThrow(
      'bad key',
    );
    expect(db.workspaceLlmKey.create).not.toHaveBeenCalled();
  });

  it(`allows at most ${LLM_KEY_LIMITS.maxKeys} keys`, async () => {
    db.workspaceLlmKey.count.mockResolvedValue(LLM_KEY_LIMITS.maxKeys);
    await expect(inTenant(() => service.create(input))).rejects.toThrow(
      ConflictException,
    );
    expect(llm.verify).not.toHaveBeenCalled();
  });

  it('switching a key off needs no provider call', async () => {
    await service.update('k1', { isActive: false });
    expect(llm.verify).not.toHaveBeenCalled();
  });

  it('a new model is verified with the stored key', async () => {
    await service.update('k1', { model: 'gpt-y' });
    expect(llm.verify).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-y',
      apiKey: 'sk-secret-1234',
    });
  });

  it('gives chat the active keys decrypted, oldest first', async () => {
    db.workspaceLlmKey.findMany.mockResolvedValue([row()]);
    await expect(service.activeCredentials()).resolves.toEqual([
      {
        id: 'k1',
        provider: 'openai',
        model: 'gpt-x',
        apiKey: 'sk-secret-1234',
      },
    ]);
    expect(db.workspaceLlmKey.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});

describe('LLM key schemas', () => {
  it('accepts only OpenAI, Gemini and Groq', () => {
    const body = { model: 'm', apiKey: 'sk-12345678' };
    expect(
      createLlmKeySchema.safeParse({ ...body, provider: 'groq' }).success,
    ).toBe(true);
    expect(
      createLlmKeySchema.safeParse({ ...body, provider: 'anthropic' }).success,
    ).toBe(false);
  });

  it('rejects a key with spaces inside and an empty update', () => {
    expect(
      createLlmKeySchema.safeParse({
        provider: 'openai',
        model: 'm',
        apiKey: 'sk-1234 5678',
      }).success,
    ).toBe(false);
    expect(updateLlmKeySchema.safeParse({}).success).toBe(false);
  });

  it('cannot change the provider of a saved key', () => {
    expect(updateLlmKeySchema.safeParse({ provider: 'groq' }).success).toBe(
      false,
    );
  });
});
