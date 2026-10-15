import { runRetrievalEval } from './retrieval-eval';

/** One dimension per known word: texts sharing a word point the same way. */
const WORDS = ['hours', 'open', 'return', 'refund', 'ship', 'delivery'];
const embed = (text: string) => {
  const v = WORDS.map((w) => (text.toLowerCase().includes(w) ? 1 : 0));
  const norm = Math.hypot(...v) || 1;
  return Promise.resolve(v.map((x) => x / norm));
};

describe('runRetrievalEval', () => {
  it('ranks items and reports recall@k and MRR', async () => {
    const report = await runRetrievalEval(
      embed,
      [
        {
          id: 'faq-hours',
          question: 'Opening hours?',
          answer: 'We open at 10.',
        },
      ],
      [
        {
          id: 'policy-returns',
          title: 'Returns',
          content: 'Return within 14 days for a refund.',
        },
        {
          id: 'policy-shipping',
          title: 'Shipping',
          content: 'We ship with delivery in 2 days.',
        },
      ],
      [
        { question: 'when do you open', expected: 'faq-hours' },
        { question: 'can I get a refund', expected: 'policy-returns' },
        { question: 'what about delivery', expected: 'policy-shipping' },
        { question: 'something unrelated', expected: 'policy-shipping' },
      ],
      1,
    );

    expect(report.chunks).toBe(3);
    expect(report.results.map((r) => r.rank)).toEqual([1, 1, 1, 3]);
    expect(report.recallAtK).toBe(0.75);
    expect(report.meanReciprocalRank).toBeCloseTo((1 + 1 + 1 + 1 / 3) / 4);
    expect(report.results[0].top).toEqual(['faq-hours']);
  });
});
