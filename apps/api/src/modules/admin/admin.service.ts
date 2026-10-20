import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  WorkspacePlan,
  WorkspaceRole,
  WorkspaceStatus,
} from '../../generated/prisma/client';
import { StorageService } from '../../storage/storage.service';
import { runAsSystem } from '../../tenancy/tenant-context';
import { periodOf } from '../usage/usage.service';
import { WidgetPageCache } from '../widget-page/widget-page.cache';
import type {
  AuditLogQueryDto,
  DeleteWorkspaceDto,
  ListWorkspacesQueryDto,
  UpdateWorkspaceDto,
} from './dto/admin.dto';

import {
  DEFAULT_USAGE_COST_CONFIG,
  periodRange,
  recentPeriods,
  sumCosts,
  withCost,
  type UsageCostConfig,
  type UsageNumbers,
} from './usage-cost';

const DEFAULT_LIMIT = 25;
/** The usage overview lists at most this many workspaces. */
const OVERVIEW_MAX = 500;
const DETAIL_MONTHS = 6;

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
  private readonly logger = new Logger(AdminService.name);

  /** The clock; tests replace it. */
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly widgetCache: WidgetPageCache,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The platform-admin console reads every workspace on purpose, so its
   * queries run with the Row-Level Security bypass (M7-1). The controller
   * only lets platform admins in.
   */
  private asPlatform<T>(fn: () => Promise<T>): Promise<T> {
    return runAsSystem('platform-admin console', fn);
  }

  private costConfig(): UsageCostConfig {
    return (
      this.config.get<UsageCostConfig>('adminUsage') ??
      DEFAULT_USAGE_COST_CONFIG
    );
  }

  listWorkspaces(query: ListWorkspacesQueryDto) {
    return this.asPlatform(() => this.listWorkspacesInner(query));
  }

  private async listWorkspacesInner(query: ListWorkspacesQueryDto) {
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

  /**
   * Every workspace's usage this month plus platform totals (M6-12). Counts
   * and token sums only: it never reads conversation or message text.
   * Costs are estimates; see usage-cost.ts.
   */
  usageOverview() {
    return this.asPlatform(() => this.usageOverviewInner());
  }

  private async usageOverviewInner() {
    const config = this.costConfig();
    const period = periodOf(this.now());
    const { start, end } = periodRange(period);
    const range = { gte: start, lt: end };
    const [workspaces, counters, conversations, leads] = await Promise.all([
      this.prisma.workspace.findMany({
        take: OVERVIEW_MAX,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, plan: true, status: true },
      }),
      this.prisma.usageCounter.findMany({ where: { period } }),
      this.prisma.conversation.groupBy({
        by: ['workspaceId'],
        where: { isPreview: false, startedAt: range },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['workspaceId'],
        where: { createdAt: range },
        _count: { _all: true },
      }),
    ]);
    const counterOf = new Map(counters.map((c) => [c.workspaceId, c]));
    const convOf = new Map(
      conversations.map((c) => [c.workspaceId, c._count._all]),
    );
    const leadOf = new Map(leads.map((l) => [l.workspaceId, l._count._all]));
    const items = workspaces.map((w) => {
      const c = counterOf.get(w.id);
      return {
        workspaceId: w.id,
        name: w.name,
        plan: w.plan,
        status: w.status,
        ...withCost(
          {
            conversations: convOf.get(w.id) ?? 0,
            messages: c?.messages ?? 0,
            previewMessages: c?.previewMessages ?? 0,
            leads: leadOf.get(w.id) ?? 0,
            tokensIn: Number(c?.tokensIn ?? 0),
            tokensOut: Number(c?.tokensOut ?? 0),
          },
          w.plan,
          config,
        ),
      };
    });
    return {
      period,
      assumptions: config,
      totals: sumCosts(items),
      workspaceCount: workspaces.length,
      items,
    };
  }

  /** One workspace's usage this month and the previous months (M6-12). */
  workspaceUsage(id: string) {
    return this.asPlatform(() => this.workspaceUsageInner(id));
  }

  private async workspaceUsageInner(id: string) {
    const config = this.costConfig();
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true, name: true, plan: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const periods = recentPeriods(this.now(), DETAIL_MONTHS);
    const counters = await this.prisma.usageCounter.findMany({
      where: { workspaceId: id, period: { in: periods } },
    });
    const months = await Promise.all(
      periods.map(async (period) => {
        const { start, end } = periodRange(period);
        const range = { gte: start, lt: end };
        const [conversations, leads] = await Promise.all([
          this.prisma.conversation.count({
            where: { workspaceId: id, isPreview: false, startedAt: range },
          }),
          this.prisma.lead.count({
            where: { workspaceId: id, createdAt: range },
          }),
        ]);
        const c = counters.find((x) => x.period === period);
        const usage: UsageNumbers = {
          conversations,
          messages: c?.messages ?? 0,
          previewMessages: c?.previewMessages ?? 0,
          leads,
          tokensIn: Number(c?.tokensIn ?? 0),
          tokensOut: Number(c?.tokensOut ?? 0),
        };
        return { period, ...withCost(usage, workspace.plan, config) };
      }),
    );
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
      },
      assumptions: config,
      months,
    };
  }

  updateWorkspace(
    actor: AdminActor,
    id: string,
    dto: UpdateWorkspaceDto,
  ): Promise<AdminWorkspaceRow> {
    return this.asPlatform(() => this.updateWorkspaceInner(actor, id, dto));
  }

  private async updateWorkspaceInner(
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

  /**
   * Read-only look at how a company set up its chatbot and knowledge base
   * (M7-35, "support view"): config, FAQs, custom answers and the list of
   * sources. Never conversations, messages or leads. Every call is audited,
   * because it shows a company's own content to the platform team.
   */
  supportView(actor: AdminActor, id: string) {
    return this.asPlatform(() => this.supportViewInner(actor, id));
  }

  private async supportViewInner(actor: AdminActor, id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true,
        website: true,
        industry: true,
        contactEmail: true,
        contactPhone: true,
        timeZone: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const [chatbots, faqs, customAnswers, sources] = await Promise.all([
      this.prisma.chatbot.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          publicId: true,
          status: true,
          allowedDomains: true,
          installVerifiedHost: true,
          draftConfig: true,
          publishedVersion: { select: { version: true, publishedAt: true } },
        },
      }),
      this.prisma.faq.findMany({
        where: { workspaceId: id },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, question: true, answer: true },
      }),
      this.prisma.customAnswer.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          triggerQuestion: true,
          answer: true,
          isActive: true,
        },
      }),
      this.prisma.knowledgeSource.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          title: true,
          status: true,
          error: true,
          fileName: true,
          fileSize: true,
          createdAt: true,
        },
      }),
    ]);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorEmail: actor.email,
        action: 'workspace.support_view',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        details: {},
      },
    });
    return { workspace, chatbots, faqs, customAnswers, sources };
  }

  /**
   * Deletes a workspace and everything it owns (the database cascades; the
   * uploaded files go from storage afterwards). The slug must be typed
   * again. The audit row is written in the same transaction and outlives
   * the workspace. Its members' accounts stay.
   */
  deleteWorkspace(actor: AdminActor, id: string, dto: DeleteWorkspaceDto) {
    return this.asPlatform(() => this.deleteWorkspaceInner(actor, id, dto));
  }

  private async deleteWorkspaceInner(
    actor: AdminActor,
    id: string,
    dto: DeleteWorkspaceDto,
  ): Promise<{ deleted: true; filesDeleted: number }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        _count: { select: { chatbots: true, members: true } },
        chatbots: { select: { publicId: true } },
        sources: {
          where: { fileKey: { not: null } },
          select: { fileKey: true },
        },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (dto.confirmSlug !== workspace.slug) {
      throw new BadRequestException(
        'Type the workspace slug exactly to confirm the deletion',
      );
    }
    const fileKeys = workspace.sources.flatMap((s) =>
      s.fileKey ? [s.fileKey] : [],
    );
    await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: {
          actorUserId: actor.id,
          actorEmail: actor.email,
          action: 'workspace.delete',
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          details: {
            slug: workspace.slug,
            plan: workspace.plan,
            chatbots: workspace._count.chatbots,
            members: workspace._count.members,
            files: fileKeys.length,
            reason: dto.reason || undefined,
          },
        },
      }),
      this.prisma.workspace.delete({ where: { id } }),
    ]);
    for (const bot of workspace.chatbots) {
      this.widgetCache.invalidate(bot.publicId);
    }
    let filesDeleted = 0;
    try {
      filesDeleted = await this.storage.deleteForWorkspace(id, fileKeys);
    } catch (err) {
      this.logger.warn(
        `Workspace ${id} deleted but its files were not removed: ${String(err)}`,
      );
    }
    return { deleted: true, filesDeleted };
  }

  auditLog(query: AuditLogQueryDto) {
    return this.asPlatform(() => this.auditLogInner(query));
  }

  private async auditLogInner(query: AuditLogQueryDto) {
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
