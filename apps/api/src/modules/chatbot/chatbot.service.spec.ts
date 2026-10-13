import { type ChatbotConfig, defaultChatbotConfig } from '@brainstack/shared';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { ChatbotService } from './chatbot.service';

const publishable = (): ChatbotConfig => {
  const config = defaultChatbotConfig('Acme');
  config.business.description = 'We sell shoes.';
  return config;
};

interface Row {
  id: string;
  publicId: string;
  status: 'ENABLED' | 'DISABLED';
  draftConfig: unknown;
  allowedDomains: string[];
  publishedVersion: {
    version: number;
    publishedAt: Date;
    config: unknown;
  } | null;
}

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'user-1', role: 'ADMIN' }, fn);

describe('ChatbotService', () => {
  let service: ChatbotService;
  let row: Row;
  let db: {
    chatbot: { findFirst: jest.Mock; update: jest.Mock };
    chatbotVersion: { aggregate: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let nodeEnv: string;

  beforeEach(async () => {
    nodeEnv = 'development';
    row = {
      id: 'bot-1',
      publicId: 'cb_abcdefghijklmnop',
      status: 'ENABLED',
      draftConfig: publishable(),
      allowedDomains: [],
      publishedVersion: null,
    };
    db = {
      chatbot: {
        findFirst: jest.fn(() => Promise.resolve(row)),
        update: jest.fn(),
      },
      chatbotVersion: {
        aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
        create: jest.fn(({ data }: { data: { version: number } }) =>
          Promise.resolve({ id: 'ver-1', ...data }),
        ),
      },
      $transaction: jest.fn((fn: (tx: typeof db) => unknown) => fn(db)),
    };
    // Applies the update to `row`; a new publishedVersionId stands in for
    // the include, which would load that version.
    db.chatbot.update.mockImplementation(
      ({ data }: { data: Partial<Row> & { publishedVersionId?: string } }) => {
        const { publishedVersionId, ...rest } = data;
        row = { ...row, ...rest };
        if (publishedVersionId) {
          row.publishedVersion = {
            version: 1,
            publishedAt: new Date(),
            config: row.draftConfig,
          };
        }
        return Promise.resolve(row);
      },
    );

    const module = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: TENANT_PRISMA, useValue: db },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'nodeEnv' ? nodeEnv : 'https://cdn.test/chatbot.js',
          },
        },
      ],
    }).compile();
    service = module.get(ChatbotService);
  });

  describe('get', () => {
    it('returns the view with the embed snippet', async () => {
      const view = await service.get();

      expect(view).toMatchObject({
        id: 'bot-1',
        publishedVersion: null,
        hasUnpublishedChanges: true,
        publishProblems: [],
        embedSnippet:
          '<script src="https://cdn.test/chatbot.js" data-chatbot-id="cb_abcdefghijklmnop" async></script>',
      });
    });

    it('is a 404 when the workspace has no chatbot', async () => {
      db.chatbot.findFirst.mockResolvedValue(null);
      await expect(service.get()).rejects.toThrow(NotFoundException);
    });

    it('sees no unpublished changes when the draft equals the live config', async () => {
      // Same content, different key order (as jsonb returns it).
      const { schemaVersion, ...rest } = publishable();
      row.publishedVersion = {
        version: 1,
        publishedAt: new Date(),
        config: { ...rest, schemaVersion },
      };

      expect((await service.get()).hasUnpublishedChanges).toBe(false);
    });

    it('lists publish problems for the dashboard', async () => {
      row.draftConfig = defaultChatbotConfig('Acme');
      expect((await service.get()).publishProblems).toEqual([
        expect.objectContaining({ code: 'BUSINESS_DESCRIPTION_MISSING' }),
      ]);

      row.draftConfig = { broken: true };
      expect((await service.get()).publishProblems).toEqual([
        expect.objectContaining({ code: 'DRAFT_INVALID' }),
      ]);
    });
  });

  describe('saveDraft', () => {
    it('saves the draft without touching the live version', async () => {
      const draft = publishable();
      draft.identity.botName = 'Ava';

      const view = await service.saveDraft(draft);

      expect(db.chatbot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bot-1' },
          data: { draftConfig: draft },
        }),
      );
      expect(view.draftConfig).toEqual(draft);
      expect(db.chatbotVersion.create).not.toHaveBeenCalled();
    });

    it('refuses image URLs until uploads exist (M2-9)', async () => {
      const draft = publishable();
      draft.identity.avatarUrl = 'https://elsewhere.com/a.png';

      await expect(service.saveDraft(draft)).rejects.toThrow(
        BadRequestException,
      );
      expect(db.chatbot.update).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('copies the draft into the next version and makes it live', async () => {
      db.chatbotVersion.aggregate.mockResolvedValue({ _max: { version: 2 } });

      const view = await inTenant(() => service.publish('user-1'));

      expect(db.chatbotVersion.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          chatbotId: 'bot-1',
          version: 3,
          config: publishable(),
          publishedById: 'user-1',
        },
      });
      expect(db.chatbot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { publishedVersionId: 'ver-1' } }),
      );
      expect(view.hasUnpublishedChanges).toBe(false);
    });

    it('starts at version 1', async () => {
      await inTenant(() => service.publish('user-1'));

      expect(db.chatbotVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 1 }) as unknown,
      });
    });

    it('does nothing when the draft is already live', async () => {
      row.publishedVersion = {
        version: 1,
        publishedAt: new Date(),
        config: publishable(),
      };

      await inTenant(() => service.publish('user-1'));

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('is a 400 with the reasons when the draft is not ready', async () => {
      row.draftConfig = defaultChatbotConfig('Acme');

      const error = await inTenant(() => service.publish('user-1')).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ code: 'BUSINESS_DESCRIPTION_MISSING' }],
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('is a 409 when another publish took the version number', async () => {
      db.chatbotVersion.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(inTenant(() => service.publish('user-1'))).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('discardDraft', () => {
    it('resets the draft to the live config', async () => {
      const live = publishable();
      row.publishedVersion = {
        version: 1,
        publishedAt: new Date(),
        config: live,
      };
      row.draftConfig = { ...live, schemaVersion: 1, extra: 'edited' };

      await service.discardDraft();

      expect(db.chatbot.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { draftConfig: live } }),
      );
    });

    it('is a 409 before the first publish', async () => {
      await expect(service.discardDraft()).rejects.toThrow(ConflictException);
    });
  });

  describe('setAllowedDomains', () => {
    it('saves the normalized list', async () => {
      const view = await service.setAllowedDomains([' Shop.Example.com ']);

      expect(view.allowedDomains).toEqual(['shop.example.com']);
    });

    it('rejects localhost in production', async () => {
      nodeEnv = 'production';

      await expect(service.setAllowedDomains(['localhost'])).rejects.toThrow(
        BadRequestException,
      );
      expect(db.chatbot.update).not.toHaveBeenCalled();
    });
  });

  it('setStatus switches the bot on or off', async () => {
    const view = await service.setStatus('DISABLED');
    expect(view.status).toBe('DISABLED');
  });
});
