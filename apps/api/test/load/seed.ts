import 'reflect-metadata';
import { LOAD_DB } from './apply-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaClient, WorkspaceRole } from '../../src/generated/prisma/client';
import { ChatbotService } from '../../src/modules/chatbot/chatbot.service';
import { chunkText } from '../../src/modules/knowledge/chunk-text';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import {
  SAMPLE_FAQS,
  SAMPLE_POLICIES,
} from '../../src/modules/knowledge/eval/sample-shop';
import {
  type EmbeddedChunk,
  KnowledgeService,
} from '../../src/modules/knowledge/knowledge.service';
import { LlmKeysService } from '../../src/modules/llm-keys/llm-keys.service';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { runWithTenant } from '../../src/tenancy/tenant-context';
import {
  TENANT_PRISMA,
  type TenantPrisma,
} from '../../src/tenancy/tenant-prisma';
import {
  LOAD_APP_PASSWORD,
  LOAD_APP_ROLE,
  MANIFEST_PATH,
  type SeedManifest,
} from './load-env';

/**
 * Seeds the load-test database (M7-5, M7-6):
 *
 *   pnpm --filter api test:load:seed [--chunks 3000] [--workspaces 1]
 *
 * - creates the `*_load` database if missing, migrates it, lets
 *   brainstack_app log in;
 * - with the app's own services: a user, a workspace with one chatbot, a
 *   (fake) LLM key, the sample shop's FAQs and policies as knowledge
 *   (chunked and embedded with the real local model) and a published
 *   chatbot;
 * - tops the chatbot up to `--chunks` chunks with synthetic ones whose
 *   embeddings are real vectors plus noise (clustered like real text);
 * - `--workspaces N` adds N-1 other workspaces with the same amount of
 *   knowledge each, so retrieval has other tenants' rows to skip.
 *
 * It only ever touches the `*_load` database, and replaces the earlier
 * "Load test" workspaces in it.
 */

const OWNER_EMAIL = 'load-owner@example.test';
const WORKSPACE_PREFIX = 'Load test';
const BULK_BATCH = 1000;
const BASE_TEXTS = 400;

function argList(name: string, fallback: number[]): number[] {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const values = (process.argv[i + 1] ?? '').split(',').map(Number);
  if (
    values.length === 0 ||
    values.some((v) => !Number.isInteger(v) || v < 1)
  ) {
    throw new Error(`--${name} must be positive integers, comma-separated`);
  }
  return values;
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

/** Deterministic pseudo-random numbers, so two seeds give the same data. */
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

const NOUNS = [
  'shoe',
  'boot',
  'sandal',
  'sneaker',
  'loafer',
  'slipper',
  'sock',
  'insole',
  'lace',
  'polish',
];
const COLOURS = [
  'black',
  'brown',
  'navy',
  'white',
  'grey',
  'tan',
  'olive',
  'red',
];
const TOPICS = [
  'delivery',
  'returns',
  'warranty',
  'sizing',
  'payment',
  'care',
  'stock',
  'discount',
  'gift',
  'store hours',
];
const TEMPLATES = [
  (n: string, c: string, t: string) =>
    `The ${c} ${n} is made for daily wear. Questions about ${t} for this model are answered on the product page.`,
  (n: string, c: string, t: string) =>
    `For ${t}: the ${c} ${n} follows our standard policy. Contact support if the ${n} arrives damaged.`,
  (n: string, c: string, t: string) =>
    `${t} guide. Our ${n} range, including the ${c} version, comes in sizes 36 to 46 and ships from the Dhaka warehouse.`,
  (n: string, c: string, t: string) =>
    `Customers ask about ${t} before buying the ${c} ${n}. We recommend checking the size chart and the care tips first.`,
];

function syntheticTexts(count: number, random: () => number): string[] {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  return Array.from({ length: count }, () =>
    pick(TEMPLATES)(pick(NOUNS), pick(COLOURS), pick(TOPICS)),
  );
}

function gaussian(random: () => number): number {
  return (
    Math.sqrt(-2 * Math.log(random() || 1e-9)) *
    Math.cos(2 * Math.PI * random())
  );
}

function noisy(base: number[], random: () => number): number[] {
  const v = base.map((x) => x + gaussian(random) * 0.04);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
}

async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: maintenance.toString() }),
  });
  try {
    const rows = await client.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists`;
    if (!rows[0]?.exists) {
      // The name was checked to end in _load and comes from our own config.
      await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      console.log(`Created database ${name}`);
    }
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  // --chunks 3000 (every workspace) or --chunks 5000,10000,50000 (one size per
  // workspace, the first is the load-test workspace).
  const chunkSizes = argList('chunks', [3000]);
  const workspaceCount = Math.max(arg('workspaces', 1), chunkSizes.length);
  const db = LOAD_DB;
  // Fast fake model: the seed only needs the key to "verify".
  process.env.LOAD_TEST_FAKE_FIRST_TOKEN_MS = '0';
  process.env.LOAD_TEST_FAKE_TOKEN_MS = '0';
  process.env.LOAD_TEST_FAKE_TOKENS = '1';

  await ensureDatabase(db.adminUrl, db.name);
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: db.adminUrl },
    stdio: 'inherit',
  });

  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: db.adminUrl }),
  });
  // A password can not be a bind parameter in DDL; both values are constants.
  await owner.$executeRawUnsafe(
    `ALTER ROLE ${LOAD_APP_ROLE} LOGIN PASSWORD '${LOAD_APP_PASSWORD}'`,
  );

  // Earlier load workspaces (and their rows, by cascade) in this database.
  await owner.workspace.deleteMany({
    where: { name: { startsWith: WORKSPACE_PREFIX } },
  });
  const user = await owner.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      name: 'Load Owner',
      passwordHash: 'not-used',
    },
  });

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const workspaces = app.get(WorkspacesService);
    const embedding = app.get(EmbeddingService);
    const knowledge = app.get(KnowledgeService);
    const tenantDb = app.get<TenantPrisma>(TENANT_PRISMA);
    const embedModel = embedding.modelName;

    // Real embeddings for the sample shop and for BASE_TEXTS made-up texts.
    const random = rng(42);
    console.log(`Embedding ${BASE_TEXTS} base texts with ${embedModel} ...`);
    const baseTexts = syntheticTexts(BASE_TEXTS, random);
    const baseVectors: number[][] = [];
    for (const text of baseTexts) baseVectors.push(await embedding.embed(text));

    const sampleDocs = [
      ...SAMPLE_POLICIES.map((p) => ({
        type: 'POLICY' as const,
        title: p.title,
        content: p.content,
      })),
      ...SAMPLE_FAQS.map((f) => ({
        type: 'TEXT' as const,
        title: f.question,
        content: `Q: ${f.question}\nA: ${f.answer}`,
      })),
    ];
    const sampleChunks: {
      doc: (typeof sampleDocs)[number];
      embedded: EmbeddedChunk[];
    }[] = [];
    for (const doc of sampleDocs) {
      const embedded: EmbeddedChunk[] = [];
      for (const chunk of chunkText([{ text: doc.content }], doc.title)) {
        embedded.push({
          ...chunk,
          embedding: await embedding.embed(chunk.content),
        });
      }
      sampleChunks.push({ doc, embedded });
    }
    const sampleChunkCount = sampleChunks.reduce(
      (n, s) => n + s.embedded.length,
      0,
    );

    const manifestBot = { publicId: '', workspaceId: '', chatbotId: '' };
    let chunksTotal = 0;
    let firstWorkspaceChunks = 0;

    for (let w = 0; w < workspaceCount; w++) {
      const created = await workspaces.createWithOwner({
        name: `${WORKSPACE_PREFIX} ${w === 0 ? 'main' : `other ${w}`}`,
        ownerUserId: user.id,
      });
      const bot = created.chatbots[0];
      const context = {
        workspaceId: created.id,
        userId: user.id,
        role: WorkspaceRole.OWNER,
      };

      await runWithTenant(context, async () => {
        // Sample shop knowledge through the app's own services.
        for (const { doc, embedded } of sampleChunks) {
          const source = await tenantDb.knowledgeSource.create({
            data: {
              workspaceId: created.id,
              chatbotId: bot.id,
              type: doc.type,
              title: doc.title,
              content: doc.content,
              status: 'READY',
            },
          });
          await tenantDb.$transaction((tx) =>
            knowledge.replaceSourceChunks(tx, bot.id, source.id, embedded),
          );
        }
        if (w === 0) {
          await app.get(LlmKeysService).create({
            provider: 'openai',
            model: 'fake-load-test-model',
            apiKey: 'sk-fake-load-test-key-0000',
          });
        }
      });

      // The bulk: synthetic chunks in one source, on the owner connection
      // with multi-row inserts (the app's per-chunk insert takes minutes at
      // tens of thousands).
      const bulkSource = await owner.knowledgeSource.create({
        data: {
          workspaceId: created.id,
          chatbotId: bot.id,
          type: 'TEXT',
          title: 'Load test synthetic chunks',
          content: 'synthetic',
          status: 'READY',
        },
      });
      const chunksPerWorkspace = chunkSizes[Math.min(w, chunkSizes.length - 1)];
      if (w === 0) firstWorkspaceChunks = chunksPerWorkspace;
      const bulkTarget = Math.max(chunksPerWorkspace - sampleChunkCount, 0);
      const bulkRandom = rng(1000 + w);
      for (let done = 0; done < bulkTarget; done += BULK_BATCH) {
        const n = Math.min(BULK_BATCH, bulkTarget - done);
        const contents: string[] = [];
        const vectors: string[] = [];
        const indexes: number[] = [];
        for (let i = 0; i < n; i++) {
          const b = Math.floor(bulkRandom() * BASE_TEXTS);
          contents.push(`${baseTexts[b]} (item ${done + i})`);
          vectors.push(`[${noisy(baseVectors[b], bulkRandom).join(',')}]`);
          indexes.push(sampleChunkCount + done + i);
        }
        await owner.$executeRaw`
          INSERT INTO knowledge_chunks
            (workspace_id, chatbot_id, source_id, chunk_index, content, metadata, embedding, embedding_model)
          SELECT ${created.id}::uuid, ${bot.id}::uuid, ${bulkSource.id}::uuid, t.idx, t.content,
                 '{"title":"Load test synthetic chunks","headingPath":[]}'::jsonb,
                 t.vec::vector, ${embedModel}
          FROM unnest(${indexes}::int[], ${contents}::text[], ${vectors}::text[]) AS t(idx, content, vec)`;
      }
      chunksTotal += sampleChunkCount + bulkTarget;

      if (w === 0) {
        await runWithTenant(context, async () => {
          const chatbots = app.get(ChatbotService);
          const { config } = await chatbots.draft();
          await chatbots.saveDraft({
            ...config,
            business: {
              ...config.business,
              description: 'A made-up shoe shop used for the local load test.',
            },
          });
          await chatbots.publish(user.id);
        });
        Object.assign(manifestBot, {
          publicId: bot.publicId,
          workspaceId: created.id,
          chatbotId: bot.id,
        });
      }
      console.log(
        `Workspace ${w + 1}/${workspaceCount} seeded (${sampleChunkCount + bulkTarget} chunks)`,
      );
    }

    await owner.$executeRawUnsafe('ANALYZE knowledge_chunks');
    const manifest: SeedManifest = {
      ...manifestBot,
      database: db.name,
      chunksInLoadWorkspace: Math.max(firstWorkspaceChunks, sampleChunkCount),
      chunksTotal,
      workspaces: workspaceCount,
      seededAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(
      `Seeded ${db.name}: ${chunksTotal} chunks. Manifest: ${MANIFEST_PATH}`,
    );
  } finally {
    await app.close();
    await owner.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
