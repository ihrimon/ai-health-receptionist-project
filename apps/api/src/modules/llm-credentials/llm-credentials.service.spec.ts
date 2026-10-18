import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../../database/prisma.service';
import { LlmProvider } from '../../generated/prisma/client';
import { ProviderRegistry } from '../llm/providers/provider-registry';
import {
  LlmCredentialsService,
  maskApiKey,
  toCredentialView,
} from './llm-credentials.service';

interface AuditData {
  action: string;
  actorEmail: string;
  details: Record<string, unknown>;
}

const actor = { id: 'admin-1', email: 'admin@example.test' };

describe('LlmCredentialsService', () => {
  let service: LlmCredentialsService;
  let llmCredential: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    aggregate: jest.Mock;
  };
  let auditLog: { create: jest.Mock };
  const firstAudit = (): AuditData =>
    (auditLog.create.mock.calls[0] as [{ data: AuditData }])[0].data;
  let prismaMock: Record<string, unknown>;
  let providerRegistry: { get: jest.Mock };
  let adapter: { complete: jest.Mock };

  beforeEach(async () => {
    auditLog = { create: jest.fn().mockResolvedValue({}) };
    adapter = { complete: jest.fn().mockResolvedValue({ message: {} }) };
    providerRegistry = { get: jest.fn().mockReturnValue(adapter) };
    llmCredential = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'cred-1', provider: 'groq', model: 'm' }),
      update: jest
        .fn()
        .mockResolvedValue({ id: 'cred-1', provider: 'groq', model: 'm' }),
      delete: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
    };

    prismaMock = {
      llmCredential,
      auditLog,
      // Both the callback and the array form, like the real client.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prismaMock)
          : Promise.all(arg as unknown[]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmCredentialsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProviderRegistry, useValue: providerRegistry },
        {
          provide: SecretBox,
          useValue: new SecretBox(new ConfigService({ nodeEnv: 'test' })),
        },
      ],
    }).compile();

    service = module.get<LlmCredentialsService>(LlmCredentialsService);
  });

  describe('create', () => {
    const dto = {
      provider: LlmProvider.gemini,
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
    };

    it('validates the credential against the real provider before saving', async () => {
      llmCredential.create.mockResolvedValue({ id: 'cred-1', ...dto });

      await service.create(actor, dto);

      expect(providerRegistry.get).toHaveBeenCalledWith(LlmProvider.gemini);
      expect(adapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-key', model: dto.model }),
      );
      expect(llmCredential.create).toHaveBeenCalled();
    });

    it('writes an audit row without the key', async () => {
      llmCredential.create.mockResolvedValue({ id: 'cred-1', ...dto });

      await service.create(actor, dto);

      const audit = firstAudit();
      expect(audit.action).toBe('llm_credential.create');
      expect(audit.actorEmail).toBe(actor.email);
      expect(JSON.stringify(audit)).not.toContain('test-key');
    });

    it('writes no audit row when the provider rejects the key', async () => {
      adapter.complete.mockRejectedValue(new Error('bad key'));
      await expect(service.create(actor, dto)).rejects.toThrow();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('appends the new credential after the current last one', async () => {
      llmCredential.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });

      await service.create(actor, dto);

      expect(llmCredential.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          apiKey: expect.stringMatching(/^v1:/) as string,
          sortOrder: 3,
        },
      });
    });

    it('gives the first credential sortOrder 0', async () => {
      await service.create(actor, dto);

      expect(llmCredential.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          apiKey: expect.stringMatching(/^v1:/) as string,
          sortOrder: 0,
        },
      });
    });

    it('stores the key encrypted, never as plain text (M7-2)', async () => {
      await service.create(actor, dto);

      const { data } = (
        llmCredential.create.mock.calls[0] as [{ data: { apiKey: string } }]
      )[0];
      expect(data.apiKey).not.toContain(dto.apiKey);
      expect(SecretBox.isEncrypted(data.apiKey)).toBe(true);
    });

    it('rejects with the provider error when the key/model is invalid, without saving', async () => {
      adapter.complete.mockRejectedValue(
        new Error('[404 Not Found] This model is no longer available'),
      );

      await expect(service.create(actor, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(llmCredential.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-validates when the model changes', async () => {
      llmCredential.findUnique.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: 'existing-key',
        model: 'old-model',
      });

      await service.update(actor, 'cred-1', { model: 'new-model' });

      expect(adapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'existing-key',
          model: 'new-model',
        }),
      );
      expect(llmCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        // A key saved as plain text is encrypted by this edit.
        data: {
          model: 'new-model',
          apiKey: expect.stringMatching(/^v1:/) as string,
        },
      });
    });

    it('reads an encrypted key back as plain text for validation (M7-2)', async () => {
      const box = new SecretBox(new ConfigService({ nodeEnv: 'test' }));
      llmCredential.findUnique.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: box.encrypt('stored-secret-9999'),
        model: 'old-model',
      });

      await service.update(actor, 'cred-1', { model: 'new-model' });

      expect(adapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'stored-secret-9999' }),
      );
    });

    it('does not re-validate a pure isActive toggle', async () => {
      llmCredential.findUnique.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: 'existing-key',
        model: 'old-model',
        isActive: true,
      });

      await service.update(actor, 'cred-1', { isActive: false });

      expect(adapter.complete).not.toHaveBeenCalled();
    });

    it('audits a key rotation as a flag, never the key value', async () => {
      llmCredential.findUnique.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: 'old-secret-key-1234',
        model: 'm',
      });
      llmCredential.update.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        model: 'm',
      });

      await service.update(actor, 'cred-1', { apiKey: 'new-secret-key-5678' });

      const audit = firstAudit();
      expect(audit.action).toBe('llm_credential.update');
      expect(audit.details.keyRotated).toBe(true);
      const text = JSON.stringify(audit);
      expect(text).not.toContain('secret-key');
    });

    it('throws NotFoundException for an unknown id', async () => {
      llmCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.update(actor, 'missing', { model: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes and audits in one transaction', async () => {
      llmCredential.findUnique.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: 'a-very-secret-key',
        model: 'm',
      });

      await service.remove(actor, 'cred-1');

      expect(llmCredential.delete).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
      });
      const audit = firstAudit();
      expect(audit.action).toBe('llm_credential.delete');
      expect(JSON.stringify(audit)).not.toContain('secret');
    });

    it('throws NotFoundException for an unknown id and audits nothing', async () => {
      llmCredential.findUnique.mockResolvedValue(null);
      await expect(service.remove(actor, 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('audits the new order', async () => {
      llmCredential.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      await service.reorder(actor, ['b', 'a']);
      expect(firstAudit().action).toBe('llm_credential.reorder');
    });

    it('rejects a list that is not the existing ids', async () => {
      llmCredential.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      await expect(service.reorder(actor, ['a'])).rejects.toThrow(
        BadRequestException,
      );
      expect(auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('masking', () => {
    it('shows only the last 4 characters of a long key', () => {
      expect(maskApiKey('gsk_abcdefghijklmnop1234')).toBe('••••••••1234');
    });

    it('shows no characters of a short key', () => {
      expect(maskApiKey('short-key')).toBe('••••••••');
    });

    it('the view never contains the stored key', () => {
      const view = toCredentialView({
        id: 'c',
        provider: LlmProvider.groq,
        apiKey: 'gsk_abcdefghijklmnop1234',
        model: 'm',
      } as never);
      expect(view).not.toHaveProperty('apiKey');
      expect(JSON.stringify(view)).not.toContain('abcdefghij');
    });
  });
});
