import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { LlmProvider } from '../../generated/prisma/client';
import { ProviderRegistry } from '../chat/providers/provider-registry';
import { LlmCredentialsService } from './llm-credentials.service';

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
  let providerRegistry: { get: jest.Mock };
  let adapter: { complete: jest.Mock };

  beforeEach(async () => {
    adapter = { complete: jest.fn().mockResolvedValue({ message: {} }) };
    providerRegistry = { get: jest.fn().mockReturnValue(adapter) };
    llmCredential = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmCredentialsService,
        { provide: PrismaService, useValue: { llmCredential } },
        { provide: ProviderRegistry, useValue: providerRegistry },
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

      await service.create(dto);

      expect(providerRegistry.get).toHaveBeenCalledWith(LlmProvider.gemini);
      expect(adapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-key', model: dto.model }),
      );
      expect(llmCredential.create).toHaveBeenCalled();
    });

    it('appends the new credential after the current last one', async () => {
      llmCredential.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });

      await service.create(dto);

      expect(llmCredential.create).toHaveBeenCalledWith({
        data: { ...dto, sortOrder: 3 },
      });
    });

    it('gives the first credential sortOrder 0', async () => {
      await service.create(dto);

      expect(llmCredential.create).toHaveBeenCalledWith({
        data: { ...dto, sortOrder: 0 },
      });
    });

    it('rejects with the provider error when the key/model is invalid, without saving', async () => {
      adapter.complete.mockRejectedValue(
        new Error('[404 Not Found] This model is no longer available'),
      );

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
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

      await service.update('cred-1', { model: 'new-model' });

      expect(adapter.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'existing-key',
          model: 'new-model',
        }),
      );
      expect(llmCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        data: { model: 'new-model' },
      });
    });

    it('does not re-validate a pure isActive toggle', async () => {
      llmCredential.findUnique.mockResolvedValue({
        id: 'cred-1',
        provider: LlmProvider.groq,
        apiKey: 'existing-key',
        model: 'old-model',
        isActive: true,
      });

      await service.update('cred-1', { isActive: false });

      expect(adapter.complete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown id', async () => {
      llmCredential.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { model: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
