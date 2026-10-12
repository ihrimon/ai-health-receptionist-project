import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, WorkspaceRole } from '../../generated/prisma/client';
import { defaultChatbotConfig } from './default-chatbot-config';
import {
  generateChatbotPublicId,
  slugify,
  withRandomSuffix,
} from './workspace-ids';

const SLUG_ATTEMPTS = 5;

export type WorkspaceWithChatbots = Prisma.WorkspaceGetPayload<{
  include: { chatbots: true };
}>;

export interface CreateWorkspaceInput {
  name: string;
  ownerUserId: string;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a workspace with `ownerUserId` as its OWNER, plus the workspace's
   * one chatbot with the default draft config (M1-15, M0 decision B2).
   *
   * Pass `tx` to run inside the caller's transaction — registration creates
   * the user in the same one (M1-16). Without it, this opens its own.
   */
  async createWithOwner(
    input: CreateWorkspaceInput,
    tx?: Prisma.TransactionClient,
  ): Promise<WorkspaceWithChatbots> {
    if (!tx) {
      return this.prisma.$transaction((t) => this.createWithOwner(input, t));
    }

    const name = input.name.trim();
    const slug = await this.pickFreeSlug(tx, slugify(name));

    return tx.workspace.create({
      data: {
        name,
        slug,
        members: {
          create: { userId: input.ownerUserId, role: WorkspaceRole.OWNER },
        },
        chatbots: {
          create: {
            publicId: generateChatbotPublicId(),
            draftConfig: defaultChatbotConfig(name),
          },
        },
      },
      include: { chatbots: true },
    });
  }

  // Check-then-insert: two signups racing for the same slug can still hit
  // the unique index, which surfaces as a failed transaction. Rare enough
  // that retrying the signup is fine.
  private async pickFreeSlug(
    tx: Prisma.TransactionClient,
    base: string,
  ): Promise<string> {
    let candidate = base;
    for (let i = 0; i < SLUG_ATTEMPTS; i++) {
      const taken = await tx.workspace.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
      candidate = withRandomSuffix(base);
    }
    throw new ConflictException('Could not find a free workspace slug');
  }
}
