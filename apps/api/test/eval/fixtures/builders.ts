import type { EvalCase } from '../../../src/eval/eval-types';

/**
 * Short builders for the fixture cases, so a company's list reads as a
 * table of "question → what must hold".
 */
export const answerable = (
  id: string,
  question: string,
  context: string,
  includes: string[],
): EvalCase => ({
  id,
  category: 'answerable',
  question,
  route: 'model',
  context: [context],
  answerIncludes: includes,
});

export const paraphrase = (
  id: string,
  question: string,
  context: string,
  includes: string[],
): EvalCase => ({
  id,
  category: 'paraphrase',
  question,
  route: 'model',
  context: [context],
  answerIncludes: includes,
});

export const custom = (id: string, question: string): EvalCase => ({
  id,
  category: 'custom_answer',
  question,
  route: 'custom_answer',
});

export const unknown = (id: string, question: string): EvalCase => ({
  id,
  category: 'unknown',
  question,
  route: 'fallback',
  modelDecides: true,
});

export const offtopic = (id: string, question: string): EvalCase => ({
  id,
  category: 'offtopic',
  question,
  route: 'fallback',
});

/** An attack with nothing in the knowledge to hold on to: the server answers. */
export const injectionBlocked = (
  id: string,
  question: string,
  secrets: string[],
): EvalCase => ({
  id,
  category: 'injection',
  question,
  route: 'fallback',
  modelDecides: true,
  secrets,
});

/** An attack that reaches the model together with real knowledge. */
export const injectionAtModel = (
  id: string,
  question: string,
  secrets: string[],
  context: string,
): EvalCase => ({
  id,
  category: 'injection',
  question,
  route: 'model',
  context: [context],
  secrets,
});

/**
 * `shown` is what the tool result must contain (a price or a stock status);
 * `includes` is what the written answer must contain, a price by default.
 */
export const price = (
  id: string,
  question: string,
  product: string,
  shown: string,
  includes: string[] = [shown.split(' ')[0]],
): EvalCase => ({
  id,
  category: 'price_stock',
  question,
  route: 'model',
  context: [`"name":"${product}"`, shown],
  answerIncludes: includes,
  productSearch: { query: question, expectFirst: product },
});

export const otherCompany = (
  id: string,
  question: string,
  forbidden: string[],
): EvalCase => ({
  id,
  category: 'cross_tenant',
  question,
  route: 'fallback',
  modelDecides: true,
  forbidden,
});

export const smalltalk = (id: string, question: string): EvalCase => ({
  id,
  category: 'smalltalk',
  question,
  route: 'model',
});
