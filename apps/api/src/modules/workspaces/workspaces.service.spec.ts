import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceRole } from '../../generated/prisma/client';
import { defaultChatbotConfig } from './default-chatbot-config';
import { WorkspacesService } from './workspaces.service';

// The parts of workspace.create()'s argument these tests look at.
interface CreateArgs {
  data: {
    name: string;
    slug: string;
    members: { create: unknown };
    chatbots: {
      create: {
        publicId: string;
        draftConfig: ReturnType<typeof defaultChatbotConfig>;
      };
    };
  };
}

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let workspace: {
    findUnique: jest.Mock;
    create: jest.Mock<object, [CreateArgs]>;
  };
  let tx: { workspace: typeof workspace };
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    workspace = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: CreateArgs) => ({ id: 'ws-1', ...data })),
    };
    tx = { workspace };
    prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
  });

  const createArgs = (): CreateArgs => workspace.create.mock.calls[0][0];

  describe('createWithOwner', () => {
    it('creates the workspace, its OWNER membership and default chatbot in one write', async () => {
      await service.createWithOwner({
        name: ' Acme Shop ',
        ownerUserId: 'user-1',
      });

      expect(workspace.create).toHaveBeenCalledTimes(1);
      const { data } = createArgs();
      expect(data.name).toBe('Acme Shop');
      expect(data.slug).toBe('acme-shop');
      expect(data.members.create).toEqual({
        userId: 'user-1',
        role: WorkspaceRole.OWNER,
      });
      expect(data.chatbots.create.publicId).toMatch(/^cb_[0-9a-zA-Z]{16}$/);
    });

    it('seeds the chatbot draft config with the company name (D-4 §4)', async () => {
      await service.createWithOwner({
        name: 'Acme Shop',
        ownerUserId: 'user-1',
      });

      const config = createArgs().data.chatbots.create.draftConfig;
      expect(config.schemaVersion).toBe(1);
      expect(config.business.name).toBe('Acme Shop');
      expect(config.identity.botName).toBe('Assistant');
    });

    it('opens its own transaction when the caller passes none', async () => {
      await service.createWithOwner({ name: 'Acme', ownerUserId: 'user-1' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("runs inside the caller's transaction when given one", async () => {
      await service.createWithOwner(
        { name: 'Acme', ownerUserId: 'user-1' },
        tx as never,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(workspace.create).toHaveBeenCalledTimes(1);
    });

    it('adds a random suffix when the slug is taken', async () => {
      workspace.findUnique.mockResolvedValueOnce({ id: 'other' });

      await service.createWithOwner({ name: 'Acme', ownerUserId: 'user-1' });

      expect(createArgs().data.slug).toMatch(/^acme-[0-9a-z]{6}$/);
    });

    it('gives up with 409 when no free slug turns up', async () => {
      workspace.findUnique.mockResolvedValue({ id: 'other' });

      await expect(
        service.createWithOwner({ name: 'Acme', ownerUserId: 'user-1' }),
      ).rejects.toThrow(ConflictException);
      expect(workspace.create).not.toHaveBeenCalled();
    });
  });
});
