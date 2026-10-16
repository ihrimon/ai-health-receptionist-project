import type { UsageView } from '@brainstack/shared';
import { Inject, Injectable } from '@nestjs/common';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';

/** The calendar month, UTC, as "2026-10". */
export function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Postgres' unique-violation, seen when two first answers of a month race. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * How much chat a workspace used this month (M3-11, M3-13). Must run in a
 * tenant context; the tenant client adds the workspace to every query.
 */
@Injectable()
export class UsageService {
  /** Replaceable in tests. */
  now: () => Date = () => new Date();

  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /** Counts one answer: a live visitor's, or a dashboard Test chat one. */
  async record(answer: {
    preview: boolean;
    tokensIn: number;
    tokensOut: number;
  }): Promise<void> {
    const { workspaceId } = requireTenant();
    const period = periodOf(this.now());
    const increments = {
      messages: { increment: answer.preview ? 0 : 1 },
      previewMessages: { increment: answer.preview ? 1 : 0 },
      tokensIn: { increment: answer.tokensIn },
      tokensOut: { increment: answer.tokensOut },
    };
    const write = () =>
      this.db.usageCounter.upsert({
        where: { workspaceId_period: { workspaceId, period } },
        create: {
          workspaceId,
          period,
          messages: answer.preview ? 0 : 1,
          previewMessages: answer.preview ? 1 : 0,
          tokensIn: answer.tokensIn,
          tokensOut: answer.tokensOut,
        },
        update: increments,
      });
    try {
      await write();
    } catch (err) {
      // The month's first two answers arrived together: the other one
      // created the row, so this one is now a plain increment.
      if (!isUniqueViolation(err)) throw err;
      await write();
    }
  }

  /** This month so far; zeros before the first answer. */
  async current(): Promise<UsageView> {
    const { workspaceId } = requireTenant();
    const period = periodOf(this.now());
    const row = await this.db.usageCounter.findUnique({
      where: { workspaceId_period: { workspaceId, period } },
    });
    return {
      period,
      messages: row?.messages ?? 0,
      previewMessages: row?.previewMessages ?? 0,
      tokensIn: Number(row?.tokensIn ?? 0),
      tokensOut: Number(row?.tokensOut ?? 0),
      limit: null,
    };
  }
}
