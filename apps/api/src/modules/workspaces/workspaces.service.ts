import { defaultChatbotConfig } from '@brainstack/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, WorkspaceRole } from '../../generated/prisma/client';
import { requireTenant, runAsSystem } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { WorkspaceAccessService } from '../../tenancy/workspace-access.service';
import type { AuthContext } from '../auth/auth-context';
import {
  canonicalTimeZone,
  type UpdateWorkspaceDto,
} from './dto/workspace.dto';
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

/** What Settings → Workspace shows and edits (M7-42). */
const PROFILE_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  createdAt: true,
  website: true,
  industry: true,
  contactEmail: true,
  contactPhone: true,
  timeZone: true,
} satisfies Prisma.WorkspaceSelect;

export type WorkspaceProfile = Prisma.WorkspaceGetPayload<{
  select: typeof PROFILE_SELECT;
}>;

export interface WorkspaceMemberRow {
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

const toProfile = (row: WorkspaceProfile): WorkspaceProfile => row;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Points the session at another workspace the user belongs to. */
  async switchActive(auth: AuthContext, workspaceId: string): Promise<void> {
    const role = await this.access.roleIn(auth.user.id, workspaceId);
    if (!role) throw new NotFoundException('Workspace not found');
    await this.prisma.session.update({
      where: { id: auth.session.id },
      data: { activeWorkspaceId: workspaceId },
    });
  }

  /** The current workspace as its owner sees it in Settings (M7-42). */
  async profile(): Promise<WorkspaceProfile> {
    const row = await this.db.workspace.findUniqueOrThrow({
      where: { id: requireTenant().workspaceId },
      select: PROFILE_SELECT,
    });
    return toProfile(row);
  }

  /**
   * Changes the fields sent (name, website, industry, contact, time zone).
   * The slug stays, so links keep working. Nothing to change is a 400.
   */
  async updateCurrent(dto: UpdateWorkspaceDto): Promise<WorkspaceProfile> {
    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.website !== undefined) data.website = dto.website;
    if (dto.industry !== undefined) data.industry = dto.industry;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.timeZone !== undefined) {
      data.timeZone = canonicalTimeZone(dto.timeZone);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Send at least one field to change');
    }
    const row = await this.db.workspace.update({
      where: { id: requireTenant().workspaceId },
      data,
      select: PROFILE_SELECT,
    });
    return toProfile(row);
  }

  /**
   * Who belongs to the current workspace (owner and admin only): name,
   * email, role and since when. Never anything else of their account.
   */
  async members(): Promise<WorkspaceMemberRow[]> {
    const rows = await this.db.workspaceMember.findMany({
      select: {
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
    return rows.map((r) => ({
      name: r.user.name,
      email: r.user.email,
      role: r.role,
      joinedAt: r.createdAt,
    }));
  }

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
      // A workspace that doesn't exist yet has no id to scope to (M7-1).
      return runAsSystem('create workspace', () =>
        this.prisma.$transaction((t) => this.createWithOwner(input, t)),
      );
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
