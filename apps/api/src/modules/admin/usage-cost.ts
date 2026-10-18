import type { WorkspacePlan } from '../../generated/prisma/client';

/**
 * Price assumptions behind the admin usage and cost view (M6-12). Every
 * number here is an ESTIMATE: tokens come from our own counters, prices from
 * configuration. Real revenue arrives with billing (M6).
 */
export interface UsageCostConfig {
  /** USD per million input tokens, one average price for every model. */
  llmPriceInPerMillion: number;
  /** USD per million output tokens. */
  llmPriceOutPerMillion: number;
  /**
   * 0..1: how much of the chat ran on a platform key. Companies bring their
   * own key (M3-21), so this is 0 unless the platform pays for some chat.
   */
  platformKeyShare: number;
  /** Monthly price per plan in USD, set by hand until billing exists. */
  planPriceUsd: Record<WorkspacePlan, number>;
}

export const DEFAULT_USAGE_COST_CONFIG: UsageCostConfig = {
  llmPriceInPerMillion: 0.15,
  llmPriceOutPerMillion: 0.6,
  platformKeyShare: 0,
  planPriceUsd: { BETA: 0, STARTER: 29, GROWTH: 99 },
};

export interface UsageNumbers {
  conversations: number;
  messages: number;
  previewMessages: number;
  leads: number;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageCost extends UsageNumbers {
  /** Estimated LLM cost of all chat, whoever pays the provider. */
  estimatedCostUsd: number;
  /** The part on a platform key: what the platform actually pays. */
  platformCostUsd: number;
  /** The part on the company's own key: paid by the company. */
  ownKeyCostUsd: number;
  /** Manual plan price for this month (not real revenue). */
  revenueUsd: number;
  /** revenueUsd - platformCostUsd. An estimate. */
  profitUsd: number;
}

/** Money rounded to 6 decimals, so sums of tiny costs don't drift. */
const money = (n: number) => Math.round(n * 1e6) / 1e6;

export function estimateCostUsd(
  tokensIn: number,
  tokensOut: number,
  config: Pick<
    UsageCostConfig,
    'llmPriceInPerMillion' | 'llmPriceOutPerMillion'
  >,
): number {
  return money(
    (tokensIn * config.llmPriceInPerMillion +
      tokensOut * config.llmPriceOutPerMillion) /
      1_000_000,
  );
}

export function withCost(
  usage: UsageNumbers,
  plan: WorkspacePlan,
  config: UsageCostConfig,
): UsageCost {
  const estimatedCostUsd = estimateCostUsd(
    usage.tokensIn,
    usage.tokensOut,
    config,
  );
  const share = Math.min(1, Math.max(0, config.platformKeyShare));
  const platformCostUsd = money(estimatedCostUsd * share);
  const revenueUsd = config.planPriceUsd[plan] ?? 0;
  return {
    ...usage,
    estimatedCostUsd,
    platformCostUsd,
    ownKeyCostUsd: money(estimatedCostUsd - platformCostUsd),
    revenueUsd,
    profitUsd: money(revenueUsd - platformCostUsd),
  };
}

export function sumCosts(rows: UsageCost[]): UsageCost {
  const total = rows.reduce<UsageCost>(
    (acc, r) => ({
      conversations: acc.conversations + r.conversations,
      messages: acc.messages + r.messages,
      previewMessages: acc.previewMessages + r.previewMessages,
      leads: acc.leads + r.leads,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      estimatedCostUsd: acc.estimatedCostUsd + r.estimatedCostUsd,
      platformCostUsd: acc.platformCostUsd + r.platformCostUsd,
      ownKeyCostUsd: acc.ownKeyCostUsd + r.ownKeyCostUsd,
      revenueUsd: acc.revenueUsd + r.revenueUsd,
      profitUsd: acc.profitUsd + r.profitUsd,
    }),
    {
      conversations: 0,
      messages: 0,
      previewMessages: 0,
      leads: 0,
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
      platformCostUsd: 0,
      ownKeyCostUsd: 0,
      revenueUsd: 0,
      profitUsd: 0,
    },
  );
  return {
    ...total,
    estimatedCostUsd: money(total.estimatedCostUsd),
    platformCostUsd: money(total.platformCostUsd),
    ownKeyCostUsd: money(total.ownKeyCostUsd),
    revenueUsd: money(total.revenueUsd),
    profitUsd: money(total.profitUsd),
  };
}

/** The last `count` calendar months (UTC) ending at `now`, newest first: ["2026-10", "2026-09", …]. */
export function recentPeriods(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** [start, end) of a "2026-10" period, UTC. */
export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0
    ? n
    : fallback;
}

/** Reads the ADMIN_* environment values; anything missing or invalid keeps its default. */
export function usageCostConfigFromEnv(
  env: NodeJS.ProcessEnv,
): UsageCostConfig {
  const d = DEFAULT_USAGE_COST_CONFIG;
  return {
    llmPriceInPerMillion: num(env.ADMIN_LLM_PRICE_IN, d.llmPriceInPerMillion),
    llmPriceOutPerMillion: num(
      env.ADMIN_LLM_PRICE_OUT,
      d.llmPriceOutPerMillion,
    ),
    platformKeyShare: Math.min(
      1,
      num(env.ADMIN_PLATFORM_KEY_SHARE, d.platformKeyShare),
    ),
    planPriceUsd: {
      BETA: 0,
      STARTER: num(env.ADMIN_PLAN_PRICE_STARTER, d.planPriceUsd.STARTER),
      GROWTH: num(env.ADMIN_PLAN_PRICE_GROWTH, d.planPriceUsd.GROWTH),
    },
  };
}
