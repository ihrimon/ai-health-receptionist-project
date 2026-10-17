import {
  DEFAULT_USAGE_COST_CONFIG,
  estimateCostUsd,
  periodRange,
  recentPeriods,
  sumCosts,
  usageCostConfigFromEnv,
  withCost,
} from './usage-cost';

const config = {
  llmPriceInPerMillion: 0.15,
  llmPriceOutPerMillion: 0.6,
  platformKeyShare: 0,
  planPriceUsd: { BETA: 0, STARTER: 29, GROWTH: 99 },
};
const usage = {
  conversations: 3,
  messages: 20,
  previewMessages: 1,
  leads: 2,
  tokensIn: 2_000_000,
  tokensOut: 1_000_000,
};

describe('estimateCostUsd', () => {
  it('prices input and output tokens per million', () => {
    expect(estimateCostUsd(2_000_000, 1_000_000, config)).toBe(0.9);
    expect(estimateCostUsd(0, 0, config)).toBe(0);
    expect(estimateCostUsd(1000, 0, config)).toBe(0.00015);
  });
});

describe('withCost', () => {
  it('puts the whole cost on the company key by default, so profit equals revenue', () => {
    expect(withCost(usage, 'STARTER', config)).toMatchObject({
      estimatedCostUsd: 0.9,
      platformCostUsd: 0,
      ownKeyCostUsd: 0.9,
      revenueUsd: 29,
      profitUsd: 29,
    });
  });

  it('splits the cost by the platform-key share and can go negative', () => {
    const r = withCost(
      { ...usage, tokensIn: 100_000_000, tokensOut: 50_000_000 },
      'BETA',
      { ...config, platformKeyShare: 0.5 },
    );
    expect(r.estimatedCostUsd).toBe(45);
    expect(r.platformCostUsd).toBe(22.5);
    expect(r.ownKeyCostUsd).toBe(22.5);
    expect(r.revenueUsd).toBe(0);
    expect(r.profitUsd).toBe(-22.5);
  });

  it('clamps a share outside 0..1', () => {
    expect(
      withCost(usage, 'BETA', { ...config, platformKeyShare: 7 })
        .platformCostUsd,
    ).toBe(0.9);
  });
});

describe('sumCosts', () => {
  it('adds every field and is zero for no rows', () => {
    const t = sumCosts([
      withCost(usage, 'STARTER', config),
      withCost(usage, 'GROWTH', config),
    ]);
    expect(t).toMatchObject({
      messages: 40,
      tokensIn: 4_000_000,
      estimatedCostUsd: 1.8,
      revenueUsd: 128,
      profitUsd: 128,
    });
    expect(sumCosts([]).revenueUsd).toBe(0);
  });
});

describe('periods', () => {
  it('lists months newest first across a year boundary', () => {
    expect(recentPeriods(new Date('2026-02-15T00:00:00Z'), 4)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
  it('gives a half-open UTC range', () => {
    const { start, end } = periodRange('2026-12');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('usageCostConfigFromEnv', () => {
  it('defaults when unset and ignores invalid values; BETA stays free', () => {
    expect(usageCostConfigFromEnv({})).toEqual(DEFAULT_USAGE_COST_CONFIG);
    const c = usageCostConfigFromEnv({
      ADMIN_LLM_PRICE_IN: 'abc',
      ADMIN_PLAN_PRICE_STARTER: '49',
      ADMIN_PLATFORM_KEY_SHARE: '3',
    });
    expect(c.llmPriceInPerMillion).toBe(0.15);
    expect(c.planPriceUsd).toEqual({ BETA: 0, STARTER: 49, GROWTH: 99 });
    expect(c.platformKeyShare).toBe(1);
  });
});
