import {
  type CaseMetrics,
  formatMetrics,
  percentile,
  pricesFromEnv,
  summarizeMetrics,
} from './eval-metrics';

const metrics = (over: Partial<CaseMetrics> = {}): CaseMetrics => ({
  firstWordMs: 800,
  totalMs: 1500,
  tokensIn: 1000,
  tokensOut: 50,
  modelCalls: 1,
  ...over,
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(percentile(values, 50)).toBe(1000);
    expect(percentile(values, 95)).toBe(1900);
    expect(percentile(values, 100)).toBe(2000);
  });

  it('does not depend on the order and is null for nothing', () => {
    expect(percentile([300, 100, 200], 50)).toBe(200);
    expect(percentile([], 95)).toBeNull();
  });
});

describe('summarizeMetrics', () => {
  it('averages only the questions the model was asked', () => {
    const summary = summarizeMetrics(
      [
        metrics({ tokensIn: 1000, tokensOut: 40, modelCalls: 2 }),
        metrics({ tokensIn: 2000, tokensOut: 60, modelCalls: 1 }),
        // Answered by the server (fallback, custom answer): no model call.
        metrics({ tokensIn: 0, tokensOut: 0, modelCalls: 0, firstWordMs: 5 }),
      ],
      null,
    );
    expect(summary).toMatchObject({
      answers: 2,
      avgTokensIn: 1500,
      avgTokensOut: 50,
      avgModelCalls: 1.5,
      avgCostUsd: null,
    });
  });

  it('prices an average answer per million tokens', () => {
    const summary = summarizeMetrics(
      [metrics({ tokensIn: 2000, tokensOut: 100 })],
      { inPerMillion: 0.5, outPerMillion: 2 },
    );
    // 2000 * 0.5e-6 + 100 * 2e-6
    expect(summary.avgCostUsd).toBeCloseTo(0.0012, 8);
  });

  it('has the p95 first word to hold against the 2 second target', () => {
    const cases = [
      ...Array.from({ length: 19 }, () => metrics({ firstWordMs: 500 })),
      metrics({ firstWordMs: 3000 }),
    ];
    const summary = summarizeMetrics(cases, null);
    expect(summary.firstWordP50Ms).toBe(500);
    expect(summary.firstWordP95Ms).toBe(500);
    expect(
      summarizeMetrics([...cases, metrics({ firstWordMs: 4000 })], null)
        .firstWordP95Ms,
    ).toBe(3000);
  });

  it('is empty, not broken, with no model answers', () => {
    expect(summarizeMetrics([], null)).toMatchObject({
      answers: 0,
      firstWordP95Ms: null,
      avgTokensIn: 0,
    });
  });
});

describe('pricesFromEnv', () => {
  it('needs both prices to be numbers', () => {
    expect(
      pricesFromEnv({ EVAL_PRICE_IN: '0.5', EVAL_PRICE_OUT: '2' }),
    ).toEqual({ inPerMillion: 0.5, outPerMillion: 2 });
    expect(pricesFromEnv({ EVAL_PRICE_IN: '0.5' })).toBeNull();
    expect(
      pricesFromEnv({ EVAL_PRICE_IN: 'abc', EVAL_PRICE_OUT: '2' }),
    ).toBeNull();
    expect(pricesFromEnv({})).toBeNull();
  });
});

describe('formatMetrics', () => {
  it('shows the cost, or says how to get it', () => {
    const without = formatMetrics(summarizeMetrics([metrics()], null)).join(
      '\n',
    );
    expect(without).toContain('EVAL_PRICE_IN');
    const priced = formatMetrics(
      summarizeMetrics([metrics()], { inPerMillion: 1, outPerMillion: 4 }),
    ).join('\n');
    expect(priced).toContain('cost per answer: $0.00120');
    expect(priced).toContain('target 2000 ms');
  });
});
