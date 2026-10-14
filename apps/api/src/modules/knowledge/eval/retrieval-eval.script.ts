import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import configuration from '../../../config/configuration';
import { EmbeddingService } from '../embedding.service';
import { runRetrievalEval } from './retrieval-eval';
import { SAMPLE_FAQS, SAMPLE_POLICIES, SAMPLE_QUESTIONS } from './sample-shop';

/**
 * Runs the retrieval quality check (M2-16) with the real embedding model
 * (KNOWLEDGE_EMBEDDING_MODEL; downloads ~90 MB on first use). Not part of
 * CI. Re-run after changing chunking or the model, and record the result
 * in the M2 tracker.
 *
 *   pnpm --filter api knowledge:eval
 */
async function main(): Promise<void> {
  const embedding = new EmbeddingService(new ConfigService(configuration()));
  const report = await runRetrievalEval(
    (text) => embedding.embed(text),
    SAMPLE_FAQS,
    SAMPLE_POLICIES,
    SAMPLE_QUESTIONS,
  );

  console.log(`Model: ${embedding.modelName}`);
  console.log(
    `Index: ${SAMPLE_FAQS.length} FAQs + ${SAMPLE_POLICIES.length} policies = ${report.chunks} chunks; ${report.results.length} questions`,
  );
  console.log(
    `recall@${report.k}: ${(report.recallAtK * 100).toFixed(0)}%  ·  MRR: ${report.meanReciprocalRank.toFixed(2)}`,
  );
  for (const r of report.results) {
    const mark = r.rank !== null && r.rank <= report.k ? 'ok  ' : 'MISS';
    console.log(
      `${mark} rank ${String(r.rank ?? '-').padStart(2)}  ${r.question}  → expected ${r.expected}; top: ${r.top.join(', ')}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
