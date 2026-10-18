import { PrismaPg } from '@prisma/adapter-pg';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaClient, WorkspaceRole } from '../../src/generated/prisma/client';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { keywordQuery } from '../../src/modules/knowledge/keyword-query';
import { KnowledgeService } from '../../src/modules/knowledge/knowledge.service';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { runWithTenant } from '../../src/tenancy/tenant-context';
import { createAdminPrisma } from './admin-prisma';
import { fakeEmbeddingService } from './fake-embedding';

/**
 * M7-31: keyword search reads the stored tsvector columns
 * (`knowledge_chunks.content_tsv`, `products.search_tsv`, GIN indexed). The
 * results must be the same as with the old `to_tsvector(...)` expression,
 * stay inside the workspace and chatbot, and the planner must use the index.
 */
const CHUNKS = {
  returns: 'Returns\nYou can return any item within 30 days for a full refund.',
  shipping:
    'Shipping\nWe ship to Dhaka within 2 days. Delivery is free over 50.',
  hours:
    'Opening hours\nThe shop is open from 9am to 6pm, Saturday to Thursday.',
  payment: 'Payment\nWe accept bKash, Nagad and cash on delivery.',
  warranty: 'Warranty\nThe ZORBIX-9000 blender has a two year warranty.',
  bangla: 'ফেরত নীতি\nপণ্য ৩০ দিনের মধ্যে ফেরত দেওয়া যাবে।',
  otherBot: 'Shipping\nWe ship to Dhaka from the B warehouse.',
};

const SAMPLE_QUERIES = [
  'how long does shipping take',
  'can I return an item',
  'what time do you open',
  'do you accept bKash',
  'warranty for the ZORBIX-9000 blender',
  'ডেলিভারি কত দিনে হবে',
  'ফেরত দেওয়া যাবে কি',
  'free delivery',
  '??',
];

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

describe('Keyword search on the stored tsvector (M7-31)', () => {
  const run = randomUUID().slice(0, 8);
  let admin: PrismaClient;
  let appRole: PrismaClient;
  let knowledge: KnowledgeService;
  let closeApp: () => Promise<void>;
  const userIds: string[] = [];
  const ids = { a: '', b: '', botA: '', botB: '', sourceA: '', sourceB: '' };

  const inWorkspace = <T>(workspaceId: string, fn: () => PromiseLike<T>) =>
    runWithTenant(
      { workspaceId, userId: 'test', role: WorkspaceRole.OWNER },
      async () => await fn(),
    );

  async function insertChunk(
    workspaceId: string,
    chatbotId: string,
    sourceId: string,
    index: number,
    content: string,
  ) {
    const embedding = vectorLiteral(await fakeEmbeddingService.embed(content));
    await admin.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (workspace_id, chatbot_id, source_id, chunk_index, content, metadata, embedding, embedding_model)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, '{}'::jsonb, $6::vector, 'test/fake-bag-of-words')`,
      workspaceId,
      chatbotId,
      sourceId,
      index,
      content,
      embedding,
    );
  }

  /** The keyword half exactly as it was before M7-31 (expression, no stored column). */
  async function oldRanking(chatbotId: string, query: string) {
    const keywords = keywordQuery(query);
    if (!keywords) return [];
    const rows = await admin.$queryRawUnsafe<{ content: string }[]>(
      `SELECT c.content FROM knowledge_chunks c, to_tsquery('english', $3::text) q(query)
       WHERE c.chatbot_id = $1::uuid AND c.workspace_id = $2::uuid
         AND to_tsvector('english', c.content) @@ q.query
       ORDER BY ts_rank_cd(to_tsvector('english', c.content), q.query) DESC, c.id`,
      chatbotId,
      ids.a,
      keywords,
    );
    return rows.map((r) => r.content);
  }

  /** The keyword half as KnowledgeService.search runs it now. */
  async function newRanking(chatbotId: string, query: string) {
    const keywords = keywordQuery(query);
    if (!keywords) return [];
    const rows = await admin.$queryRawUnsafe<{ content: string }[]>(
      `SELECT c.content FROM knowledge_chunks c, to_tsquery('english', $3::text) q(query)
       WHERE c.chatbot_id = $1::uuid AND c.workspace_id = $2::uuid
         AND c.content_tsv @@ q.query
       ORDER BY ts_rank_cd(c.content_tsv, q.query) DESC, c.id`,
      chatbotId,
      ids.a,
      keywords,
    );
    return rows.map((r) => r.content);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbeddingService)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    closeApp = () => app.close();
    knowledge = app.get(KnowledgeService);
    admin = createAdminPrisma();
    appRole = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    const workspaces = app.get(WorkspacesService);
    const make = async (who: string) => {
      const user = await admin.user.create({
        data: {
          email: `fts-${run}-${who}@example.test`,
          name: who,
          passwordHash: 'not-used',
        },
      });
      userIds.push(user.id);
      return workspaces.createWithOwner({
        name: `Fts ${who} ${run}`,
        ownerUserId: user.id,
      });
    };
    const a = await make('a');
    const b = await make('b');
    Object.assign(ids, {
      a: a.id,
      b: b.id,
      botA: a.chatbots[0].id,
      botB: b.chatbots[0].id,
    });
    const sourceFor = (workspaceId: string, chatbotId: string) =>
      admin.knowledgeSource.create({
        data: { workspaceId, chatbotId, type: 'POLICY', title: 'fts' },
      });
    ids.sourceA = (await sourceFor(ids.a, ids.botA)).id;
    ids.sourceB = (await sourceFor(ids.b, ids.botB)).id;

    const shared = Object.entries(CHUNKS).filter(([k]) => k !== 'otherBot');
    for (const [index, [, content]] of shared.entries()) {
      await insertChunk(ids.a, ids.botA, ids.sourceA, index, content);
    }
    await insertChunk(ids.b, ids.botB, ids.sourceB, 0, CHUNKS.otherBot);

    await admin.product.createMany({
      data: [
        {
          workspaceId: ids.a,
          chatbotId: ids.botA,
          name: 'ZORBIX-9000 blender',
          category: 'Kitchen',
          description: 'Powerful blender with a glass jug',
          currency: 'USD',
        },
        {
          workspaceId: ids.a,
          chatbotId: ids.botA,
          name: 'Cotton t-shirt',
          category: 'Clothing',
          description: 'Soft cotton shirt',
          currency: 'USD',
        },
        {
          workspaceId: ids.b,
          chatbotId: ids.botB,
          name: 'ZORBIX-9000 blender clone',
          category: 'Kitchen',
          description: 'B shop blender',
          currency: 'USD',
        },
      ],
    });
  });

  afterAll(async () => {
    if (admin) {
      await admin.workspace.deleteMany({
        where: { id: { in: [ids.a, ids.b].filter(Boolean) } },
      });
      await admin.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await Promise.all([admin, appRole].map((c) => c?.$disconnect()));
    await closeApp?.();
  });

  it('the database fills the stored columns itself (generated)', async () => {
    const rows = await admin.$queryRawUnsafe<{ same: boolean }[]>(
      `SELECT content_tsv = to_tsvector('english', content) AS same
       FROM knowledge_chunks WHERE workspace_id = $1::uuid`,
      ids.a,
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.same)).toBe(true);
    const products = await admin.$queryRawUnsafe<{ same: boolean }[]>(
      `SELECT search_tsv = to_tsvector('english',
          name || ' ' || coalesce(category, '') || ' ' || coalesce(description, '')) AS same
       FROM products WHERE workspace_id = $1::uuid`,
      ids.a,
    );
    expect(products).toHaveLength(2);
    expect(products.every((r) => r.same)).toBe(true);
  });

  it('follows an update of the content', async () => {
    const [row] = await admin.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM knowledge_chunks WHERE workspace_id = $1::uuid AND content LIKE 'Payment%'`,
      ids.a,
    );
    await admin.$executeRawUnsafe(
      `UPDATE knowledge_chunks SET content = 'Payment\nWe accept bKash, Nagad, cards and cash on delivery.' WHERE id = $1::uuid`,
      row.id,
    );
    expect(await newRanking(ids.botA, 'cards')).toHaveLength(1);
    await admin.$executeRawUnsafe(
      `UPDATE knowledge_chunks SET content = $2 WHERE id = $1::uuid`,
      row.id,
      CHUNKS.payment,
    );
    expect(await newRanking(ids.botA, 'cards')).toHaveLength(0);
  });

  describe.each(SAMPLE_QUERIES)('sample query %j', (query) => {
    it('ranks the same chunks in the same order as the old expression', async () => {
      expect(await newRanking(ids.botA, query)).toEqual(
        await oldRanking(ids.botA, query),
      );
    });
  });

  it('search finds the expected chunk first for English questions', async () => {
    const found = async (q: string) =>
      (await inWorkspace(ids.a, () => knowledge.search(ids.botA, q, 3))).map(
        (m) => ({ text: m.content, keywordHit: m.keywordHit }),
      );
    expect((await found('how long does shipping take'))[0]).toEqual({
      text: CHUNKS.shipping,
      keywordHit: true,
    });
    expect((await found('can I return an item'))[0].text).toBe(CHUNKS.returns);
    expect((await found('warranty for the ZORBIX-9000 blender'))[0].text).toBe(
      CHUNKS.warranty,
    );
    expect((await found('do you accept bKash'))[0].text).toBe(CHUNKS.payment);
  });

  it('search finds a Bangla chunk by its words', async () => {
    const matches = await inWorkspace(ids.a, () =>
      knowledge.search(ids.botA, 'ফেরত দেওয়া যাবে কি', 3),
    );
    expect(matches[0]).toMatchObject({
      content: CHUNKS.bangla,
      keywordHit: true,
    });
  });

  it("is scoped to the workspace and the chatbot: B never sees A's chunks", async () => {
    // B asking about A's chatbot: nothing.
    await expect(
      inWorkspace(ids.b, () => knowledge.search(ids.botA, 'shipping Dhaka')),
    ).resolves.toEqual([]);
    // B's own chatbot finds only B's chunk.
    const own = await inWorkspace(ids.b, () =>
      knowledge.search(ids.botB, 'shipping Dhaka'),
    );
    expect(own.map((m) => m.content)).toEqual([CHUNKS.otherBot]);
    // A asking about B's chatbot: nothing.
    await expect(
      inWorkspace(ids.a, () => knowledge.search(ids.botB, 'shipping Dhaka')),
    ).resolves.toEqual([]);
    // A's own search never returns B's text.
    const a = await inWorkspace(ids.a, () =>
      knowledge.search(ids.botA, 'shipping Dhaka', 10, false),
    );
    expect(a.map((m) => m.content)).not.toContain(CHUNKS.otherBot);
  });

  it('Row-Level Security still hides the stored column outside a workspace', async () => {
    const outside = await appRole.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM knowledge_chunks
       WHERE content_tsv @@ to_tsquery('english', 'shipping')`,
    );
    expect(outside[0].n).toBe(0);
    const outsideProducts = await appRole.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM products
       WHERE search_tsv @@ to_tsquery('english', 'blender')`,
    );
    expect(outsideProducts[0].n).toBe(0);
  });

  describe('product search', () => {
    it('finds products by keyword, only in the workspace and chatbot', async () => {
      const hits = await inWorkspace(ids.a, () =>
        knowledge.searchProducts(ids.botA, { query: 'ZORBIX blender' }, 5),
      );
      expect(hits.map((h) => h.name)).toEqual(['ZORBIX-9000 blender']);
      const clothes = await inWorkspace(ids.a, () =>
        knowledge.searchProducts(ids.botA, { query: 'cotton shirt' }, 5),
      );
      expect(clothes.map((h) => h.name)).toEqual(['Cotton t-shirt']);
      // B sees its own product only; A's chatbot gives nothing to B.
      const b = await inWorkspace(ids.b, () =>
        knowledge.searchProducts(ids.botB, { query: 'ZORBIX blender' }, 5),
      );
      expect(b.map((h) => h.name)).toEqual(['ZORBIX-9000 blender clone']);
      await expect(
        inWorkspace(ids.b, () =>
          knowledge.searchProducts(ids.botA, { query: 'cotton shirt' }, 5),
        ),
      ).resolves.toEqual([]);
    });
  });

  describe('the planner uses the GIN index on a larger table', () => {
    const FILLER = 15000;

    async function plan(sql: string, ...params: unknown[]): Promise<string> {
      const rows = await admin.$queryRawUnsafe<Record<string, string>[]>(
        `EXPLAIN ${sql}`,
        ...params,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    }

    beforeAll(async () => {
      // Plain English filler with one rare word, spread over chunks of one
      // chatbot, so the index lookup for the rare word is clearly cheaper.
      await admin.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks (workspace_id, chatbot_id, source_id, chunk_index, content, embedding, embedding_model)
         SELECT $1::uuid, $2::uuid, $3::uuid, 1000 + i,
                'Filler text number ' || i || ' about delivery returns and opening hours of the shop'
                  || CASE WHEN i % 5000 = 0 THEN ' quokkaword' ELSE '' END,
                ('[' || repeat('0,', 383) || '0]')::vector, 'test/fake-bag-of-words'
         FROM generate_series(1, ${FILLER}) AS i`,
        ids.a,
        ids.botA,
        ids.sourceA,
      );
      await admin.$executeRawUnsafe('ANALYZE knowledge_chunks');
    });

    it('uses knowledge_chunks_content_tsv_idx for the keyword search', async () => {
      const text = await plan(
        `SELECT c.id FROM knowledge_chunks c, to_tsquery('english', 'quokkaword') q(query)
         WHERE c.workspace_id = $1::uuid AND c.chatbot_id = $2::uuid
           AND c.content_tsv @@ q.query
         ORDER BY ts_rank_cd(c.content_tsv, q.query) DESC LIMIT 20`,
        ids.a,
        ids.botA,
      );
      expect(text).toContain('knowledge_chunks_content_tsv_idx');
      expect(text).not.toMatch(/to_tsvector/);
    });

    it('still finds the rare word through the service', async () => {
      const matches = await inWorkspace(ids.a, () =>
        knowledge.search(ids.botA, 'quokkaword', 50, false),
      );
      expect(matches.filter((m) => m.keywordHit)).toHaveLength(3);
    });

    it('the old expression indexes are gone and the new ones exist', async () => {
      const rows = await admin.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE indexname IN ('knowledge_chunks_fts', 'products_fts',
                             'knowledge_chunks_content_tsv_idx', 'products_search_tsv_idx')
         ORDER BY indexname`,
      );
      expect(rows.map((r) => r.indexname)).toEqual([
        'knowledge_chunks_content_tsv_idx',
        'products_search_tsv_idx',
      ]);
    });
  });
});
