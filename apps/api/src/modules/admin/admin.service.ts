import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  WorkspacePlan,
  WorkspaceRole,
  WorkspaceStatus,
} from '../../generated/prisma/client';
import { periodOf } from '../usage/usage.service';
import { WidgetPageCache } from '../widget-page/widget-page.cache';
import type {
  AuditLogQueryDto,
  ListWorkspacesQueryDto,
  UpdateWorkspaceDto,
} from './dto/admin.dto';

const DEFAULT_LIMIT = 25;

export interface AdminActor {
  id: string;
  email: string;
}

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  plan: WorkspacePlan;
  createdAt: Date;
  owner: { id: string; name: string; email: string } | null;
  chatbotCount: number;
  /** Visitor answers this calendar month (a counter, never message text). */
  messagesThisMonth: number;
}

const workspaceSelect = (period: string) =>
  ({
    id: true,
    name: true,
    slug: true,
    status: true,
    plan: true,
    createdAt: true,
    members: {
      where: { role: WorkspaceRole.OWNER },
      orderBy: { createdAt: 'asc' },
      take: 1,
      select: { user: { select: { id: true, name: true, email: true } } },
    },
    usageCounters: { where: { period }, select: { messages: true } },
    _count: { select: { chatbots: true } },
  }) satisfies Prisma.WorkspaceSelect;

type WorkspaceWithUsage = Prisma.WorkspaceGetPayload<{
  select: ReturnType<typeof workspaceSelect>;
}>;

function toRow(w: WorkspaceWithUsage): AdminWorkspaceRow {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    status: w.status,
    plan: w.plan,
    createdAt: w.createdAt,
    owner: w.members[0]?.user ?? null,
    chatbotCount: w._count.chatbots,
    messagesThisMonth: w.usageCounters[0]?.messages ?? 0,
  };
}

/**
 * Platform-admin operations (M7-0, D-2 §2.8). Deliberately cross-tenant, so
 * it uses PrismaService (not the tenant client) and is confined to this
 * module: it never reads conversations or messages (counters only), and
 * every change is written to `audit_logs` in the same transaction.
 */
@Injectable()
export class AdminService {
  /** The clock; tests replace it. */
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly widgetCache: WidgetPageCache,
  ) {}

  async listWorkspaces(query: ListWorkspacesQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const period = periodOf(this.now());
    const where: Prisma.WorkspaceWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        {
          members: {
            some: {
              role: WorkspaceRole.OWNER,
              user: { email: { contains: query.q, mode: 'insensitive' } },
            },
          },
        },
      ];
    }
    const rows = await this.prisma.workspace.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: workspaceSelect(period),
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toRow),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async updateWorkspace(
    actor: AdminActor,
    id: string,
    dto: UpdateWorkspaceDto,
  ): Promise<AdminWorkspaceRow> {
    if (dto.status === undefined && dto.plan === undefined) {
      throw new BadRequestException('Send a status, a plan, or both');
    }
    const period = periodOf(this.now());
    const current = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, plan: true },
    });
    if (!current) throw new NotFoundException('Workspace not found');

    const reason = dto.reason || undefined;
    const audits: Prisma.AuditLogCreateManyInput[] = [];
    const data: Prisma.WorkspaceUpdateInput = {};
    const base = {
      actorUserId: actor.id,
      actorEmail: actor.email,
      workspaceId: current.id,
      workspaceName: current.name,
    };
    if (dto.status !== undefined && dto.status !== current.status) {
      data.status = dto.status;
      audits.push({
        ...base,
        action:
          dto.status === WorkspaceStatus.SUSPENDED
            ? 'workspace.suspend'
            : 'workspace.unsuspend',
        details: { from: current.status, to: dto.status, reason },
      });
    }
    if (dto.plan !== undefined && dto.plan !== current.plan) {
      data.plan = dto.plan;
      audits.push({
        ...base,
        action: 'workspace.set_plan',
        details: { from: current.plan, to: dto.plan, reason },
      });
    }

    if (audits.length > 0) {
      await this.prisma.$transaction([
        this.prisma.workspace.update({ where: { id }, data }),
        this.prisma.auditLog.createMany({ data: audits }),
      ]);
      if (data.status !== undefined) await this.dropWidgetCache(id);
    }

    const updated = await this.prisma.workspace.findUniqueOrThrow({
      where: { id },
      select: workspaceSelect(period),
    });
    return toRow(updated);
  }

  async auditLog(query: AuditLogQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.auditLog.findMany({
      where: query.workspaceId ? { workspaceId: query.workspaceId } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: page,
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** The widget page cache would serve the old state for up to a minute. */
  private async dropWidgetCache(workspaceId: string): Promise<void> {
    const bots = await this.prisma.chatbot.findMany({
      where: { workspaceId },
      select: { publicId: true },
    });
    for (const bot of bots) this.widgetCache.invalidate(bot.publicId);
  }
}
