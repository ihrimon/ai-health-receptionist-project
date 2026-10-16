/**
 * Speed and cost of the answers an eval run got from a real model (M3-19).
 * Pure arithmetic, so it can be tested without a model.
 */

/** What one answered case cost, as measured during the run. */
export interface CaseMetrics {
  /** Milliseconds from the question to the first piece of the answer. */
  firstWordMs: number | null;
  /** Milliseconds until the answer was complete. */
  totalMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Calls made to the model for this one question (tool rounds count). */
  modelCalls: number;
}

/** The p-th percentile (0 to 100), nearest rank; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export interface MetricsSummary {
  /** Questions the model was actually asked. */
  answers: number;
  firstWordP50Ms: number | null;
  firstWordP95Ms: number | null;
  totalP95Ms: number | null;
  avgTokensIn: number;
  avgTokensOut: number;
  avgModelCalls: number;
  /** Average cost of one answer in USD; null without prices. */
  avgCostUsd: number | null;
}

/** Prices in US dollars per million tokens. */
export interface Prices {
  inPerMillion: number;
  outPerMillion: number;
}

export function summarizeMetrics(
  cases: CaseMetrics[],
  prices: Prices | null,
): MetricsSummary {
  const answered = cases.filter((c) => c.modelCalls > 0);
  const avg = (pick: (c: CaseMetrics) => number) =>
    answered.length === 0
      ? 0
      : answered.reduce((sum, c) => sum + pick(c), 0) / answered.length;
  const avgTokensIn = avg((c) => c.tokensIn);
  const avgTokensOut = avg((c) => c.tokensOut);
  return {
    answers: answered.length,
    firstWordP50Ms: percentile(
      answered.flatMap((c) => (c.firstWordMs === null ? [] : [c.firstWordMs])),
      50,
    ),
    firstWordP95Ms: percentile(
      answered.flatMap((c) => (c.firstWordMs === null ? [] : [c.firstWordMs])),
      95,
    ),
    totalP95Ms: percentile(
      answered.map((c) => c.totalMs),
      95,
    ),
    avgTokensIn,
    avgTokensOut,
    avgModelCalls: avg((c) => c.modelCalls),
    avgCostUsd:
      prices === null || answered.length === 0
        ? null
        : (avgTokensIn * prices.inPerMillion +
            avgTokensOut * prices.outPerMillion) /
          1_000_000,
  };
}

/** The M3 exit criterion: the first word within 2 seconds, p95. */
export const FIRST_WORD_TARGET_MS = 2000;

export function formatMetrics(m: MetricsSummary): string[] {
  const ms = (n: number | null) => (n === null ? '-' : `${Math.round(n)} ms`);
  const lines = [
    `answers from the model ${m.answers}, model calls per answer ${m.avgModelCalls.toFixed(2)}`,
    `first word p50 ${ms(m.firstWordP50Ms)}, p95 ${ms(m.firstWordP95Ms)} (target ${FIRST_WORD_TARGET_MS} ms), complete answer p95 ${ms(m.totalP95Ms)}`,
    `tokens per answer: ${Math.round(m.avgTokensIn)} in, ${Math.round(m.avgTokensOut)} out`,
  ];
  lines.push(
    m.avgCostUsd === null
      ? 'cost per answer: set EVAL_PRICE_IN and EVAL_PRICE_OUT (USD per million tokens) to see it'
      : `cost per answer: $${m.avgCostUsd.toFixed(5)}`,
  );
  return lines;
}

/** Prices from the environment, or null when either is missing. */
export function pricesFromEnv(env: {
  EVAL_PRICE_IN?: string;
  EVAL_PRICE_OUT?: string;
}): Prices | null {
  const inPerMillion = Number(env.EVAL_PRICE_IN);
  const outPerMillion = Number(env.EVAL_PRICE_OUT);
  if (
    !env.EVAL_PRICE_IN ||
    !env.EVAL_PRICE_OUT ||
    !Number.isFinite(inPerMillion) ||
    !Number.isFinite(outPerMillion)
  ) {
    return null;
  }
  return { inPerMillion, outPerMillion };
}
