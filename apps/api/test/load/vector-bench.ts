import 'reflect-metadata';
import './apply-env';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../../src/generated/prisma/client';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { SAMPLE_QUESTIONS } from '../../src/modules/knowledge/eval/sample-shop';
import { keywordQuery } from '../../src/modules/knowledge/keyword-query';
import { LOAD_DB } from './apply-env';
import { OUT_DIR } from './load-env';

/**
 * pgvector index check (M7-6), on the `*_load` database seeded with several
 * workspaces of different sizes (for example
 * `pnpm --filter api test:load:seed -- --chunks 5000,10000,25000,50000`):
 *
 *   pnpm --filter api test:load:vector [--queries 40] [--keep-index]
 *
 * For every chatbot it runs the same retrieval query as
 * KnowledgeService.search (copied below, with the id added) as the
 * restricted app role with Row-Level Security on, first with only the
 * existing indexes, then with an HNSW index on `embedding` in three
 * settings. It reports query time (p50/p95), how often the top results
 * differ from the exact ones (recall) and whether the planner used the
 * HNSW index. The index is built in the `*_load` database only and dropped
 * again unless --keep-index is given.
 */

const TOP_K = 5;
const CANDIDATES = 20; // Math.max(topK * 4, MIN_CANDIDATES) in KnowledgeService
const RRF_K = 60;
const INDEX_NAME = 'knowledge_chunks_embedding_hnsw_bench';

const queriesArg = process.argv.indexOf('--queries');
const QUERIES = queriesArg >= 0 ? Number(process.argv[queriesArg + 1]) : 40;
const KEEP_INDEX = process.argv.includes('--keep-index');

interface Bot {
  workspaceId: string;
  chatbotId: string;
  chunks: number;
}

interface Probe {
  vector: string;
  keywords: string | null;
}

interface Mode {
  name: string;
  /** Session settings for the query (SET LOCAL equivalents). */
  settings: Record<string, string>;
  hnsw: boolean;
}

const MODES: Mode[] = [
  { name: 'exact (no HNSW index)', settings: {}, hnsw: false },
  { name: 'HNSW, ef_search 40 (default)', settings: {}, hnsw: true },
  {
    name: 'HNSW, ef_search 100, iterative relaxed_order',
    settings: {
      'hnsw.ef_search': '100',
      'hnsw.iterative_scan': 'relaxed_order',
    },
    hnsw: true,
  },
  {
    name: 'HNSW, ef_search 100, iterative strict_order',
    settings: {
      'hnsw.ef_search': '100',
      'hnsw.iterative_scan': 'strict_order',
    },
    hnsw: true,
  },
];

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Deterministic, so every mode sees the same queries. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: LOAD_DB.adminUrl }),
  });
  const app = new PrismaClient({
    adapter: new PrismaPg({ connectionString: LOAD_DB.appUrl }),
  });
  const embedding = new EmbeddingService(
    new ConfigService({
      knowledge: { embeddingModel: 'Xenova/all-MiniLM-L6-v2' },
    }),
  );

  /** Runs `fn` in a transaction as one workspace, with RLS on and optional settings. */
  const asWorkspace = <T>(
    client: PrismaClient,
    workspaceId: string,
    settings: Record<string, string>,
    fn: (
      tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    ) => Promise<T>,
  ) =>
    client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true), set_config('app.rls_bypass', 'off', true)`;
        for (const [key, value] of Object.entries(settings)) {
          await tx.$queryRaw`SELECT set_config(${key}, ${value}, true)`;
        }
        return fn(tx);
      },
      { timeout: 120_000 },
    );

  // The search query of KnowledgeService.search, plus c.id. Keep in step with it.
  const search = (
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    bot: Bot,
    probe: Probe,
  ) =>
    tx.$queryRaw<{ id: string; similarity: number }[]>`
      WITH meaning AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${probe.vector}::vector) AS rank
        FROM knowledge_chunks
        WHERE workspace_id = ${bot.workspaceId}::uuid AND chatbot_id = ${bot.chatbotId}::uuid
        ORDER BY embedding <=> ${probe.vector}::vector
        LIMIT ${CANDIDATES}
      ),
      keyword AS (
        SELECT c.id, ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(to_tsvector('english', c.content), q.query) DESC
        ) AS rank
        FROM knowledge_chunks c,
             to_tsquery('english', ${probe.keywords ?? ''}::text) AS q(query)
        WHERE ${probe.keywords !== null}
          AND c.workspace_id = ${bot.workspaceId}::uuid AND c.chatbot_id = ${bot.chatbotId}::uuid
          AND to_tsvector('english', c.content) @@ q.query
        ORDER BY ts_rank_cd(to_tsvector('english', c.content), q.query) DESC
        LIMIT ${CANDIDATES}
      ),
      fused AS (
        SELECT id, SUM(1.0 / (${RRF_K}::int + rank)) AS score
        FROM (SELECT id, rank FROM meaning UNION ALL SELECT id, rank FROM keyword) ranked
        GROUP BY id
      )
      SELECT c.id::text AS id, 1 - (c.embedding <=> ${probe.vector}::vector) AS similarity
      FROM fused f
      JOIN knowledge_chunks c ON c.id = f.id
      WHERE c.workspace_id = ${bot.workspaceId}::uuid AND c.chatbot_id = ${bot.chatbotId}::uuid
      ORDER BY f.score DESC, c.id
      LIMIT ${TOP_K}`;

  /** Only the meaning half, to see how well the index finds the true nearest chunks. */
  const nearest = (
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    bot: Bot,
    probe: Probe,
  ) =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM knowledge_chunks
      WHERE workspace_id = ${bot.workspaceId}::uuid AND chatbot_id = ${bot.chatbotId}::uuid
      ORDER BY embedding <=> ${probe.vector}::vector
      LIMIT ${CANDIDATES}`;

  const explain = (
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    bot: Bot,
    probe: Probe,
  ) =>
    tx.$queryRaw<Record<string, string>[]>`
      EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
      SELECT id FROM knowledge_chunks
      WHERE workspace_id = ${bot.workspaceId}::uuid AND chatbot_id = ${bot.chatbotId}::uuid
      ORDER BY embedding <=> ${probe.vector}::vector
      LIMIT ${CANDIDATES}`;

  try {
    // Every chatbot and its size (owner connection, RLS bypass).
    const bots = await owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.$queryRaw<
        { workspaceId: string; chatbotId: string; chunks: number }[]
      >`
        SELECT workspace_id::text AS "workspaceId", chatbot_id::text AS "chatbotId", COUNT(*)::int AS chunks
        FROM knowledge_chunks GROUP BY 1, 2 ORDER BY 3`;
    });
    const totalChunks = bots.reduce((n, b) => n + b.chunks, 0);
    const [{ version }] = await owner.$queryRaw<{ version: string }[]>`
      SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`;
    console.log(
      `pgvector ${version}; ${bots.length} chatbots, ${totalChunks} chunks: ${bots.map((b) => b.chunks).join(', ')}`,
    );

    // Queries per chatbot: real question embeddings plus stored vectors with
    // a little noise, so they land in the same clusters real questions do.
    const random = rng(7);
    const sampleVectors: Probe[] = [];
    for (const q of SAMPLE_QUESTIONS) {
      sampleVectors.push({
        vector: `[${(await embedding.embed(q.question)).join(',')}]`,
        keywords: keywordQuery(q.question),
      });
    }
    const probes = new Map<string, Probe[]>();
    for (const bot of bots) {
      const rows = await asWorkspace(
        owner,
        bot.workspaceId,
        {},
        (tx) =>
          tx.$queryRaw<{ vector: string; content: string }[]>`
          SELECT embedding::text AS vector, content FROM knowledge_chunks
          WHERE workspace_id = ${bot.workspaceId}::uuid AND chatbot_id = ${bot.chatbotId}::uuid
          ORDER BY random() LIMIT ${QUERIES}`,
      );
      const noisy: Probe[] = rows.map((r) => {
        const v = (JSON.parse(r.vector) as number[]).map(
          (x) => x + (random() - 0.5) * 0.05,
        );
        const norm = Math.hypot(...v) || 1;
        return {
          vector: `[${v.map((x) => (x / norm).toFixed(6)).join(',')}]`,
          keywords: keywordQuery(r.content.slice(0, 80)),
        };
      });
      probes.set(bot.chatbotId, [...noisy, ...sampleVectors]);
    }

    const results: unknown[] = [];
    const exactTop = new Map<string, string[][]>();
    const exactNearest = new Map<string, string[][]>();
    const plans: Record<string, string> = {};
    let indexBuildSeconds: number | null = null;
    let indexSize: string | null = null;

    for (const mode of MODES) {
      if (mode.hnsw && indexBuildSeconds === null) {
        console.log('\nBuilding the HNSW index (m=16, ef_construction=64) ...');
        const started = performance.now();
        // One transaction = one connection, so the SET LOCALs apply.
        await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL maintenance_work_mem = '512MB'`,
            );
            await tx.$executeRawUnsafe(
              `SET LOCAL max_parallel_maintenance_workers = 0`,
            );
            await tx.$executeRawUnsafe(
              `CREATE INDEX ${INDEX_NAME} ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
            );
          },
          { timeout: 1_800_000 },
        );
        await owner.$executeRawUnsafe('ANALYZE knowledge_chunks');
        indexBuildSeconds = round1((performance.now() - started) / 1000);
        const [{ size }] = await owner.$queryRaw<{ size: string }[]>`
          SELECT pg_size_pretty(pg_relation_size(${INDEX_NAME}::regclass)) AS size`;
        indexSize = size;
        console.log(`Built in ${indexBuildSeconds} s, ${indexSize}`);
      }

      console.log(`\n== ${mode.name}`);
      console.log(
        'chunks | full search p50 p95 max | nearest-20 only p50 p95 | recall@5 recall@20 | planner',
      );
      for (const bot of bots) {
        const list = probes.get(bot.chatbotId)!;
        // Warm up the caches for this chatbot (not measured).
        await asWorkspace(app, bot.workspaceId, mode.settings, (tx) =>
          search(tx, bot, list[0]),
        );
        const times: number[] = [];
        const vectorTimes: number[] = [];
        const tops: string[][] = [];
        const nears: string[][] = [];
        for (const probe of list) {
          const started = performance.now();
          const rows = await asWorkspace(
            app,
            bot.workspaceId,
            mode.settings,
            (tx) => search(tx, bot, probe),
          );
          times.push(performance.now() - started);
          tops.push(rows.map((r) => r.id));
          const nearStarted = performance.now();
          const near = await asWorkspace(
            app,
            bot.workspaceId,
            mode.settings,
            (tx) => nearest(tx, bot, probe),
          );
          vectorTimes.push(performance.now() - nearStarted);
          nears.push(near.map((r) => r.id));
        }
        if (!mode.hnsw) {
          exactTop.set(bot.chatbotId, tops);
          exactNearest.set(bot.chatbotId, nears);
        }
        const recall = (
          got: string[][],
          want: string[][] | undefined,
          k: number,
        ) => {
          if (!want) return NaN;
          let hit = 0;
          let total = 0;
          got.forEach((ids, i) => {
            const truth = new Set(want[i].slice(0, k));
            total += truth.size;
            hit += ids.slice(0, k).filter((id) => truth.has(id)).length;
          });
          return total === 0 ? 1 : hit / total;
        };
        const plan = await asWorkspace(
          app,
          bot.workspaceId,
          mode.settings,
          (tx) => explain(tx, bot, list[0]),
        );
        const planText = plan.map((r) => Object.values(r)[0]).join('\n');
        plans[`${mode.name} | ${bot.chunks} chunks`] = planText;
        const usesHnsw = planText.includes(INDEX_NAME);
        const r5 = recall(tops, exactTop.get(bot.chatbotId), TOP_K);
        const r20 = recall(nears, exactNearest.get(bot.chatbotId), CANDIDATES);
        const row = {
          mode: mode.name,
          chunks: bot.chunks,
          p50: round1(percentile(times, 50)),
          p95: round1(percentile(times, 95)),
          max: round1(Math.max(...times)),
          vectorP50: round1(percentile(vectorTimes, 50)),
          vectorP95: round1(percentile(vectorTimes, 95)),
          recallAt5: round1(r5 * 100),
          recallAt20: round1(r20 * 100),
          usesHnsw,
          queries: list.length,
        };
        results.push(row);
        console.log(
          `${String(bot.chunks).padStart(6)} ${String(row.p50).padStart(8)} ${String(row.p95).padStart(8)} ${String(row.max).padStart(8)} | ${String(row.vectorP50).padStart(8)} ${String(row.vectorP95).padStart(8)} | ${String(row.recallAt5).padStart(6)}% ${String(row.recallAt20).padStart(6)}%  ${usesHnsw ? 'HNSW index' : 'btree + sort'}`,
        );
      }
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `vector-bench-${Date.now()}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          pgvector: version,
          totalChunks,
          indexBuildSeconds,
          indexSize,
          results,
          plans,
        },
        null,
        2,
      ),
    );
    console.log(`\nSaved ${file}`);
  } finally {
    if (!KEEP_INDEX) {
      await owner.$executeRawUnsafe(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
    }
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
