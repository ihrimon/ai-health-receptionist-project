import { chunkText } from '../chunk-text';
import { faqText } from '../knowledge-ingest.service';
import type { SampleFaq, SamplePolicy, SampleQuestion } from './sample-shop';

export type Embed = (text: string) => Promise<number[]>;

export interface QuestionResult {
  question: string;
  expected: string;
  /** 1-based rank of the first chunk of the expected item; null if absent. */
  rank: number | null;
  /** Item ids of the top `k` chunks, best first. */
  top: string[];
}

export interface EvalReport {
  k: number;
  chunks: number;
  /** Share of questions whose expected item is in the top k. */
  recallAtK: number;
  /** Mean of 1/rank (0 when missing): rewards finding it first. */
  meanReciprocalRank: number;
  results: QuestionResult[];
}

/** Both vectors come normalized from the embedder, so this is cosine. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Retrieval quality check (M2-16): indexes the sample shop the way the
 * ingest job does (same chunking, same text per FAQ), then asks each
 * question and checks whether its expected item is in the top `k` chunks.
 * Search is cosine similarity in memory, which is what pgvector's `<=>`
 * computes, so no database is needed.
 */
export async function runRetrievalEval(
  embed: Embed,
  faqs: SampleFaq[],
  policies: SamplePolicy[],
  questions: SampleQuestion[],
  k = 5,
): Promise<EvalReport> {
  const index: { itemId: string; vector: number[] }[] = [];
  for (const faq of faqs) {
    for (const chunk of chunkText([{ text: faqText(faq) }], faq.question)) {
      index.push({ itemId: faq.id, vector: await embed(chunk.content) });
    }
  }
  for (const policy of policies) {
    for (const chunk of chunkText([{ text: policy.content }], policy.title)) {
      index.push({ itemId: policy.id, vector: await embed(chunk.content) });
    }
  }

  const results: QuestionResult[] = [];
  for (const { question, expected } of questions) {
    const q = await embed(question);
    const ranked = index
      .map((entry) => ({ itemId: entry.itemId, score: dot(q, entry.vector) }))
      .sort((a, b) => b.score - a.score);
    const position = ranked.findIndex((r) => r.itemId === expected);
    results.push({
      question,
      expected,
      rank: position < 0 ? null : position + 1,
      top: ranked.slice(0, k).map((r) => r.itemId),
    });
  }

  const hits = results.filter((r) => r.rank !== null && r.rank <= k).length;
  const mrr =
    results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) /
    results.length;
  return {
    k,
    chunks: index.length,
    recallAtK: hits / results.length,
    meanReciprocalRank: mrr,
    results,
  };
}
