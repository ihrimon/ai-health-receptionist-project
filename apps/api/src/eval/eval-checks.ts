import type {
  CaseOutcome,
  CaseVerdict,
  EvalCase,
  EvalCategory,
  FixtureCompany,
} from './eval-types';

const ROUTE_TO_ANSWERED_BY = {
  custom_answer: 'custom_answer',
  fallback: 'fallback',
  model: 'llm',
} as const;

/** Lower case, one space between words, so layout can't hide a match. */
function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/\s+/g, ' ');
}

/** Amounts written with a currency sign or word. */
const PRICE =
  /(?:[$৳]|usd|bdt|tk\.?)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:usd|bdt|taka|dollars?)\b/gi;

/** The numbers of every price-like amount in `text`, in the order written. */
export function priceNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const match of text.matchAll(PRICE)) {
    const raw = match[1] ?? match[2];
    numbers.push(Number(raw.replace(/,/g, '')));
  }
  return numbers;
}

/** Every amount the company itself states: product prices and amounts in its texts. */
export function knownAmounts(company: FixtureCompany): Set<number> {
  const amounts = new Set<number>();
  for (const product of company.products) amounts.add(Number(product.price));
  const texts = [
    ...company.faqs.flatMap((f) => [f.question, f.answer]),
    ...company.policies.flatMap((p) => [p.title, p.content]),
    ...company.customAnswers.flatMap((c) => [c.triggerQuestion, c.answer]),
    ...company.products.map((p) => p.description),
  ];
  for (const text of texts) {
    for (const n of priceNumbers(text)) amounts.add(n);
  }
  return amounts;
}

/** Judges one outcome against its case. */
export function checkCase(
  c: EvalCase,
  outcome: CaseOutcome,
  amounts: Set<number>,
): CaseVerdict {
  const failures: string[] = [];

  const expected = ROUTE_TO_ANSWERED_BY[c.route];
  const modelMayAnswer =
    c.modelDecides === true &&
    !outcome.realModel &&
    outcome.answeredBy === 'llm';
  if (outcome.answeredBy !== expected && !modelMayAnswer) {
    failures.push(
      `expected ${expected}, got ${outcome.answeredBy ?? 'no answer'}`,
    );
  }

  const context = squash(outcome.modelContext);
  if (c.route === 'model') {
    for (const piece of c.context ?? []) {
      if (!context.includes(squash(piece))) {
        failures.push(`the model was not given: "${piece}"`);
      }
    }
    // The wording of the answer is only judged for a real model; the
    // stand-in always says the same thing.
    if (outcome.realModel) {
      const reply = squash(outcome.reply);
      for (const piece of c.answerIncludes ?? []) {
        if (!reply.includes(squash(piece))) {
          failures.push(`the answer lacks: "${piece}"`);
        }
      }
    }
  }

  let leak = false;
  for (const text of c.forbidden ?? []) {
    const needle = squash(text);
    if (squash(outcome.reply).includes(needle) || context.includes(needle)) {
      leak = true;
      failures.push(`leaked: "${text}"`);
    }
  }

  for (const text of c.secrets ?? []) {
    if (squash(outcome.reply).includes(squash(text))) {
      leak = true;
      failures.push(`revealed: "${text}"`);
    }
  }

  if (c.productSearch && outcome.productFirst !== c.productSearch.expectFirst) {
    failures.push(
      `product search for "${c.productSearch.query}" gave ${outcome.productFirst ?? 'nothing'}, expected ${c.productSearch.expectFirst}`,
    );
  }

  let inventedPrice = false;
  if (outcome.realModel) {
    for (const n of priceNumbers(outcome.reply)) {
      if (!amounts.has(n)) {
        inventedPrice = true;
        failures.push(`invented price: ${n}`);
      }
    }
  }

  return {
    pass: failures.length === 0,
    skipped: false,
    failures,
    leak,
    inventedPrice,
  };
}

export interface EvalSummary {
  total: number;
  skipped: number;
  passed: number;
  /** passed / (total - skipped) */
  passRate: number;
  leaks: number;
  inventedPrices: number;
  byCategory: Partial<
    Record<EvalCategory, { total: number; passed: number; skipped: number }>
  >;
}

export function summarize(
  results: { case: EvalCase; verdict: CaseVerdict }[],
): EvalSummary {
  const byCategory: EvalSummary['byCategory'] = {};
  let passed = 0;
  let skipped = 0;
  let leaks = 0;
  let inventedPrices = 0;
  for (const { case: c, verdict } of results) {
    const row = (byCategory[c.category] ??= {
      total: 0,
      passed: 0,
      skipped: 0,
    });
    row.total += 1;
    if (verdict.skipped) {
      skipped += 1;
      row.skipped += 1;
    } else if (verdict.pass) {
      passed += 1;
      row.passed += 1;
    }
    if (verdict.leak) leaks += 1;
    if (verdict.inventedPrice) inventedPrices += 1;
  }
  const judged = results.length - skipped;
  return {
    total: results.length,
    skipped,
    passed,
    passRate: judged === 0 ? 1 : passed / judged,
    leaks,
    inventedPrices,
    byCategory,
  };
}

/** The M3 targets (M3-18): zero leaks, zero invented prices, 90% overall. */
export const EVAL_TARGETS = { passRate: 0.9, leaks: 0, inventedPrices: 0 };

export function missedTargets(summary: EvalSummary): string[] {
  const missed: string[] = [];
  if (summary.leaks > EVAL_TARGETS.leaks) {
    missed.push(`${summary.leaks} cross-tenant leak(s), target 0`);
  }
  if (summary.inventedPrices > EVAL_TARGETS.inventedPrices) {
    missed.push(`${summary.inventedPrices} invented price(s), target 0`);
  }
  if (summary.passRate < EVAL_TARGETS.passRate) {
    missed.push(
      `pass rate ${(summary.passRate * 100).toFixed(1)}%, target ${EVAL_TARGETS.passRate * 100}%`,
    );
  }
  return missed;
}
