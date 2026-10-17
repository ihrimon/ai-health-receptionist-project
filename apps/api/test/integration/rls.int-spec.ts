import { PrismaPg } from '@prisma/adapter-pg';
import { RlsPrismaPg } from '../../src/database/rls-adapter';
import { PrismaClient } from '../../src/generated/prisma/client';
import { runAsSystem, runWithTenant } from '../../src/tenancy/tenant-context';
import { createAdminPrisma } from './admin-prisma';

/**
 * Row-Level Security, the second layer of tenant isolation (M7-1, T4).
 *
 * The app's own scoping (tenant-isolation.int-spec.ts) is switched off on
 * purpose here: these tests talk to Postgres directly over the restricted
 * `brainstack_app` connection and set (or leave unset) the transaction
 * settings by hand. Even then workspace A can't read or write workspace B,
 * and a missing setting means no rows at all.
 */

type Tx = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
interface Ids {
  ws: string;
  user: string;
  extraUser: string;
  chatbot: string;
  conversation: string;
  source: string;
}

/** Every table that carries a workspace_id, plus `workspaces` (id). */
const TENANT_TABLES = [
  'workspace_members',
  'chatbots',
  'chatbot_versions',
  'faqs',
  'custom_answers',
  'knowledge_sources',
  'products',
  'knowledge_chunks',
  'workspace_llm_keys',
  'conversations',
  'messages',
  'usage_counters',
  'leads',
] as const;
/** workspace_id is a label there; only the RLS bypass may touch it. */
const PLATFORM_ONLY_TABLES = ['audit_logs'] as const;
const ALL_TABLES = [
  ...TENANT_TABLES,
  'workspaces',
  ...PLATFORM_ONLY_TABLES,
] as const;
type Table = (typeof ALL_TABLES)[number];

const ZERO_VECTOR =
  "('[' || array_to_string(array_fill(0.1::float8, ARRAY[384]), ',') || ']')::vector";

/** One valid INSERT per tenant table, for workspace `ws`, using A's parents. */
function insertFor(table: (typeof TENANT_TABLES)[number], ws: string, p: Ids) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const sql: Record<(typeof TENANT_TABLES)[number], [string, unknown[]]> = {
    workspace_members: [
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'VIEWER')`,
      [ws, p.extraUser],
    ],
    chatbots: [
      `INSERT INTO chatbots (workspace_id, public_id, draft_config, updated_at) VALUES ($1::uuid, $2, '{}'::jsonb, now())`,
      [ws, `cb_rls${suffix}`],
    ],
    chatbot_versions: [
      `INSERT INTO chatbot_versions (workspace_id, chatbot_id, version, config) VALUES ($1::uuid, $2::uuid, 99, '{}'::jsonb)`,
      [ws, p.chatbot],
    ],
    faqs: [
      `INSERT INTO faqs (workspace_id, chatbot_id, question, answer, updated_at) VALUES ($1::uuid, $2::uuid, 'q', 'a', now())`,
      [ws, p.chatbot],
    ],
    custom_answers: [
      `INSERT INTO custom_answers (workspace_id, chatbot_id, trigger_question, answer, updated_at) VALUES ($1::uuid, $2::uuid, 'q', 'a', now())`,
      [ws, p.chatbot],
    ],
    knowledge_sources: [
      `INSERT INTO knowledge_sources (workspace_id, chatbot_id, type, title, updated_at) VALUES ($1::uuid, $2::uuid, 'POLICY', 't', now())`,
      [ws, p.chatbot],
    ],
    products: [
      `INSERT INTO products (workspace_id, chatbot_id, currency, name, updated_at) VALUES ($1::uuid, $2::uuid, 'USD', 'n', now())`,
      [ws, p.chatbot],
    ],
    knowledge_chunks: [
      `INSERT INTO knowledge_chunks (workspace_id, chatbot_id, source_id, chunk_index, content, embedding, embedding_model) VALUES ($1::uuid, $2::uuid, $3::uuid, 7, 'c', ${ZERO_VECTOR}, 'm')`,
      [ws, p.chatbot, p.source],
    ],
    workspace_llm_keys: [
      `INSERT INTO workspace_llm_keys (workspace_id, provider, model, api_key_encrypted, key_last4, updated_at) VALUES ($1::uuid, 'groq', 'm', 'x', 'abcd', now())`,
      [ws],
    ],
    conversations: [
      `INSERT INTO conversations (workspace_id, chatbot_id, visitor_id) VALUES ($1::uuid, $2::uuid, 'v')`,
      [ws, p.chatbot],
    ],
    messages: [
      `INSERT INTO messages (workspace_id, conversation_id, role, content) VALUES ($1::uuid, $2::uuid, 'USER', 'hi')`,
      [ws, p.conversation],
    ],
    usage_counters: [
      `INSERT INTO usage_counters (workspace_id, period, updated_at) VALUES ($1::uuid, '2099-01', now())`,
      [ws],
    ],
    leads: [
      `INSERT INTO leads (workspace_id, chatbot_id) VALUES ($1::uuid, $2::uuid)`,
      [ws, p.chatbot],
    ],
  };
  return sql[table];
}

class Rollback extends Error {}

describe('Row-Level Security (M7-1)', () => {
  const run = Date.now().toString(36);
  let admin: PrismaClient;
  /** The app connection WITHOUT the app's RLS wrapper: settings by hand. */
  let raw: PrismaClient;
  /** One connection only, so a leaked setting would be seen by the next query. */
  let rawOne: PrismaClient;
  /** The real app wiring: PrismaService's adapter, driven by the ALS context. */
  let wrapped: PrismaClient;
  const url = process.env.DATABASE_URL as string;
  let A: Ids;
  let B: Ids;
  const created = { workspaceIds: [] as string[], userIds: [] as string[] };

  /** Runs `fn` in a transaction with the given settings (like the adapter does). */
  async function withSettings<T>(
    client: PrismaClient,
    settings: { workspaceId?: string; bypass?: boolean },
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      if (settings.workspaceId !== undefined) {
        await tx.$queryRawUnsafe(
          `SELECT set_config('app.workspace_id', $1, true)`,
          settings.workspaceId,
        );
      }
      if (settings.bypass) {
        await tx.$queryRawUnsafe(
          `SELECT set_config('app.rls_bypass', 'on', true)`,
        );
      }
      return fn(tx);
    });
  }

  async function count(
    tx: Tx,
    table: Table,
    where = 'true',
    ...params: unknown[]
  ): Promise<number> {
    const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${table}" WHERE ${where}`,
      ...params,
    );
    return Number(rows[0].n);
  }

  /** The column that says which workspace a row belongs to. */
  const wsColumn = (table: Table) =>
    table === 'workspaces' ? 'id' : 'workspace_id';

  async function seed(label: string): Promise<Ids> {
    const [user, extraUser] = await Promise.all(
      ['owner', 'extra'].map((who) =>
        admin.user.create({
          data: {
            email: `rls-${run}-${label}-${who}@example.com`,
            name: `RLS ${label} ${who}`,
            passwordHash: 'x',
          },
        }),
      ),
    );
    created.userIds.push(user.id, extraUser.id);
    const ws = await admin.workspace.create({
      data: {
        name: `RLS ${label} ${run}`,
        slug: `rls-${run}-${label}`,
        members: { create: { userId: user.id, role: 'OWNER' } },
        chatbots: {
          create: {
            publicId: `cb_${run}${label}`.slice(0, 24),
            draftConfig: {},
          },
        },
      },
      include: { chatbots: true },
    });
    created.workspaceIds.push(ws.id);
    const chatbot = ws.chatbots[0].id;
    const common = { workspaceId: ws.id, chatbotId: chatbot };

    await admin.chatbotVersion.create({
      data: { ...common, version: 1, config: {} },
    });
    await admin.faq.create({ data: { ...common, question: 'q', answer: 'a' } });
    await admin.customAnswer.create({
      data: { ...common, triggerQuestion: 'q', answer: 'a' },
    });
    const source = await admin.knowledgeSource.create({
      data: { ...common, type: 'POLICY', title: 't' },
    });
    await admin.product.create({
      data: { ...common, currency: 'USD', name: 'n' },
    });
    await admin.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (workspace_id, chatbot_id, source_id, chunk_index, content, embedding, embedding_model)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'c', ${ZERO_VECTOR}, 'm')`,
      ws.id,
      chatbot,
      source.id,
    );
    await admin.workspaceLlmKey.create({
      data: {
        workspaceId: ws.id,
        provider: 'groq',
        model: 'm',
        apiKeyEncrypted: 'x',
        keyLast4: 'abcd',
      },
    });
    const conversation = await admin.conversation.create({
      data: { ...common, visitorId: 'v' },
    });
    await admin.message.create({
      data: {
        workspaceId: ws.id,
        conversationId: conversation.id,
        role: 'USER',
        content: 'hi',
      },
    });
    await admin.usageCounter.create({
      data: { workspaceId: ws.id, period: '2026-10' },
    });
    await admin.lead.create({ data: { ...common } });
    await admin.auditLog.create({
      data: {
        actorEmail: `rls-${run}-${label}-owner@example.com`,
        action: 'rls.test',
        workspaceId: ws.id,
      },
    });
    return {
      ws: ws.id,
      user: user.id,
      extraUser: extraUser.id,
      chatbot,
      conversation: conversation.id,
      source: source.id,
    };
  }

  beforeAll(async () => {
    expect(url).toContain('brainstack_app');
    admin = createAdminPrisma();
    raw = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    rawOne = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url, max: 1 }),
    });
    wrapped = new PrismaClient({
      adapter: new RlsPrismaPg(new PrismaPg({ connectionString: url })),
    });
    A = await seed('a');
    B = await seed('b');
  });

  afterAll(async () => {
    if (admin) {
      await admin.auditLog.deleteMany({
        where: { actorEmail: { startsWith: `rls-${run}-` } },
      });
      await admin.workspace.deleteMany({
        where: { id: { in: created.workspaceIds } },
      });
      await admin.user.deleteMany({ where: { id: { in: created.userIds } } });
    }
    await Promise.all(
      [admin, raw, rawOne, wrapped].map((c) => c?.$disconnect()),
    );
  });

  describe('setup', () => {
    it('the API connects as a restricted role: not a superuser, no BYPASSRLS', async () => {
      const rows = await raw.$queryRawUnsafe<
        { current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >(
        `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows).toEqual([
        {
          current_user: 'brainstack_app',
          rolsuper: false,
          rolbypassrls: false,
        },
      ]);
    });

    it('every table with a workspace_id has RLS enabled, forced and a policy', async () => {
      const withColumn = await admin.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'workspace_id'`,
      );
      const tables = [...withColumn.map((r) => r.table_name), 'workspaces'];
      // A new tenant table must get a policy AND a case in this file.
      expect([...tables].sort()).toEqual([...ALL_TABLES].sort());

      const status = await admin.$queryRawUnsafe<
        {
          relname: string;
          enabled: boolean;
          forced: boolean;
          policies: bigint;
        }[]
      >(
        `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
                (SELECT count(*) FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
        [...ALL_TABLES],
      );
      expect(status).toHaveLength(ALL_TABLES.length);
      for (const row of status) {
        expect({
          table: row.relname,
          enabled: row.enabled,
          forced: row.forced,
        }).toEqual({ table: row.relname, enabled: true, forced: true });
        expect(Number(row.policies)).toBeGreaterThan(0);
      }
    });

    it('the seed holds rows for both workspaces in every table (control)', async () => {
      for (const table of ALL_TABLES) {
        const col = wsColumn(table);
        expect(
          await count(admin as unknown as Tx, table, `${col} = $1::uuid`, A.ws),
        ).toBeGreaterThan(0);
        expect(
          await count(admin as unknown as Tx, table, `${col} = $1::uuid`, B.ws),
        ).toBeGreaterThan(0);
      }
    });
  });

  describe.each(ALL_TABLES)('%s', (table) => {
    const col = wsColumn(table);
    const platformOnly = (PLATFORM_ONLY_TABLES as readonly string[]).includes(
      table,
    );

    it('shows no rows when no workspace is set (fail closed)', async () => {
      expect(await count(raw as unknown as Tx, table)).toBe(0);
      // An empty setting is the same as an unset one.
      await withSettings(raw, { workspaceId: '' }, async (tx) => {
        expect(await count(tx, table)).toBe(0);
      });
    });

    it("workspace A can't read workspace B's rows, even when asking for them", async () => {
      await withSettings(raw, { workspaceId: A.ws }, async (tx) => {
        expect(await count(tx, table, `${col} = $1::uuid`, B.ws)).toBe(0);
        const mine = await count(tx, table);
        if (platformOnly) {
          expect(mine).toBe(0);
        } else {
          // Everything it sees is its own, and it sees all of its own.
          expect(mine).toBe(
            await count(
              admin as unknown as Tx,
              table,
              `${col} = $1::uuid`,
              A.ws,
            ),
          );
          expect(mine).toBeGreaterThan(0);
        }
      });
    });

    it("workspace A can't update or delete workspace B's rows", async () => {
      await withSettings(raw, { workspaceId: A.ws }, async (tx) => {
        const set = table === 'workspaces' ? 'name = name' : `${col} = ${col}`;
        expect(
          await tx.$executeRawUnsafe(
            `UPDATE "${table}" SET ${set} WHERE ${col} = $1::uuid`,
            B.ws,
          ),
        ).toBe(0);
        expect(
          await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE ${col} = $1::uuid`,
            B.ws,
          ),
        ).toBe(0);
      });
      // Nothing happened to B's data.
      expect(
        await count(admin as unknown as Tx, table, `${col} = $1::uuid`, B.ws),
      ).toBeGreaterThan(0);
    });

    it('the bypass setting shows every workspace, and only when switched on', async () => {
      await withSettings(raw, { bypass: true }, async (tx) => {
        expect(
          await count(tx, table, `${col} = $1::uuid`, A.ws),
        ).toBeGreaterThan(0);
        expect(
          await count(tx, table, `${col} = $1::uuid`, B.ws),
        ).toBeGreaterThan(0);
      });
      // Not on: no matter what other settings say.
      await withSettings(raw, { workspaceId: A.ws }, async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT set_config('app.rls_bypass', 'off', true)`,
        );
        expect(await count(tx, table, `${col} = $1::uuid`, B.ws)).toBe(0);
      });
    });
  });

  describe.each(TENANT_TABLES)('%s (writes)', (table) => {
    const col = 'workspace_id';

    it('WITH CHECK blocks inserting a row for another workspace', async () => {
      const [sql, params] = insertFor(table, B.ws, A);
      await expect(
        withSettings(raw, { workspaceId: A.ws }, (tx) =>
          tx.$executeRawUnsafe(sql, ...params),
        ),
      ).rejects.toThrow(/row-level security/i);
      expect(
        await count(admin as unknown as Tx, table, `${col} = $1::uuid`, B.ws),
      ).toBeGreaterThan(0);
    });

    it('WITH CHECK blocks an insert when no workspace is set', async () => {
      const [sql, params] = insertFor(table, A.ws, A);
      await expect(raw.$executeRawUnsafe(sql, ...params)).rejects.toThrow(
        /row-level security/i,
      );
    });

    it('the same insert works for its own workspace (control)', async () => {
      const [sql, params] = insertFor(table, A.ws, A);
      await expect(
        withSettings(raw, { workspaceId: A.ws }, async (tx) => {
          expect(await tx.$executeRawUnsafe(sql, ...params)).toBe(1);
          throw new Rollback(); // leave the data as it was
        }),
      ).rejects.toBeInstanceOf(Rollback);
    });

    it("can't move its own row to another workspace", async () => {
      await expect(
        withSettings(raw, { workspaceId: A.ws }, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE "${table}" SET ${col} = $1::uuid WHERE ${col} = $2::uuid`,
            B.ws,
            A.ws,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  /** Tables whose rows point at a chatbot / conversation / FAQ / source. */
  const WITH_PARENTS = [
    'chatbot_versions',
    'faqs',
    'custom_answers',
    'knowledge_sources',
    'products',
    'knowledge_chunks',
    'conversations',
    'messages',
    'leads',
  ] as const;

  describe("a row can't point at another workspace's parent (same-workspace check)", () => {
    // B's parents, but the new row says it belongs to A.
    const foreignParents = (): Ids => ({ ...B, extraUser: A.extraUser });

    it.each(WITH_PARENTS)('%s: INSERT is refused', async (table) => {
      const [sql, params] = insertFor(table, A.ws, foreignParents());
      await expect(
        withSettings(raw, { workspaceId: A.ws }, (tx) =>
          tx.$executeRawUnsafe(sql, ...params),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it.each(WITH_PARENTS.filter((t) => t !== 'messages'))(
      "%s: moving a row to another workspace's chatbot is refused",
      async (table) => {
        await expect(
          withSettings(raw, { workspaceId: A.ws }, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE "${table}" SET chatbot_id = $1::uuid WHERE workspace_id = $2::uuid`,
              B.chatbot,
              A.ws,
            ),
          ),
        ).rejects.toThrow(/row-level security/i);
      },
    );

    it("a lead can't be linked to another workspace's conversation", async () => {
      await expect(
        withSettings(raw, { workspaceId: A.ws }, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE leads SET conversation_id = $1::uuid WHERE workspace_id = $2::uuid`,
            B.conversation,
            A.ws,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("a chunk can't be attached to another workspace's FAQ", async () => {
      const faqB = await admin.faq.findFirstOrThrow({
        where: { workspaceId: B.ws },
      });
      await expect(
        withSettings(raw, { workspaceId: A.ws }, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE knowledge_chunks SET faq_id = $1::uuid, source_id = NULL WHERE workspace_id = $2::uuid`,
            faqB.id,
            A.ws,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("the bypass isn't held to it (platform code decides)", async () => {
      const [sql, params] = insertFor('faqs', A.ws, foreignParents());
      await expect(
        withSettings(raw, { bypass: true }, async (tx) => {
          expect(await tx.$executeRawUnsafe(sql, ...params)).toBe(1);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    });
  });

  describe('platform tables', () => {
    it('workspaces: only the current one, and no new one can be created', async () => {
      await withSettings(raw, { workspaceId: A.ws }, async (tx) => {
        expect(await count(tx, 'workspaces')).toBe(1);
        await expect(
          tx.$executeRawUnsafe(
            `INSERT INTO workspaces (name, slug, updated_at) VALUES ('x', 'rls-x-${run}', now())`,
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it('audit_logs: unreadable and unwritable without the bypass', async () => {
      await expect(
        withSettings(raw, { workspaceId: A.ws }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO audit_logs (actor_email, action) VALUES ('x@example.com', 'rls.test')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('transaction-local settings', () => {
    it('never leak to the next user of a pooled connection', async () => {
      // A single connection: the second query reuses the first one's.
      await withSettings(rawOne, { workspaceId: A.ws }, async (tx) => {
        expect(await count(tx, 'chatbots')).toBe(1);
      });
      await withSettings(rawOne, { bypass: true }, async (tx) => {
        expect(
          await count(tx, 'chatbots', 'workspace_id = $1::uuid', A.ws),
        ).toBe(1);
      });
      expect(await count(rawOne as unknown as Tx, 'chatbots')).toBe(0);
      expect(
        await rawOne.$queryRawUnsafe(
          `SELECT current_setting('app.workspace_id', true) AS ws, current_setting('app.rls_bypass', true) AS bypass`,
        ),
      ).toEqual([{ ws: '', bypass: '' }]);
    });
  });

  describe("the app's adapter sets the settings from the request context", () => {
    const tenant = (workspaceId: string) => ({
      workspaceId,
      userId: 'rls-test',
      role: 'OWNER' as const,
    });

    it('outside any context a tenant table is empty and writes are refused', async () => {
      expect(await wrapped.chatbot.count()).toBe(0);
      expect(await wrapped.workspace.count()).toBe(0);
      await expect(
        wrapped.faq.create({
          data: {
            workspaceId: A.ws,
            chatbotId: A.chatbot,
            question: 'q',
            answer: 'a',
          },
        }),
      ).rejects.toThrow();
    });

    it("inside workspace A's context only A's rows are visible, even for B's ids", async () => {
      await runWithTenant(tenant(A.ws), async () => {
        const chatbots = await wrapped.chatbot.findMany();
        expect(chatbots.map((c) => c.workspaceId)).toEqual([A.ws]);
        expect(
          await wrapped.chatbot.findUnique({ where: { id: B.chatbot } }),
        ).toBeNull();
        expect(
          await wrapped.workspace.findUnique({ where: { id: B.ws } }),
        ).toBeNull();
        // Raw SQL that "forgets" the workspace condition is still limited.
        const rows = await wrapped.$queryRawUnsafe<{ n: bigint }[]>(
          'SELECT count(*) AS n FROM messages',
        );
        expect(Number(rows[0].n)).toBe(1);
      });
    });

    it('interactive transactions get the context too, and the context is gone afterwards', async () => {
      await runWithTenant(tenant(A.ws), async () => {
        await wrapped.$transaction(async (tx) => {
          expect(await tx.conversation.count()).toBe(1);
          expect(
            await tx.conversation.count({ where: { workspaceId: B.ws } }),
          ).toBe(0);
        });
      });
      expect(await wrapped.conversation.count()).toBe(0);
    });

    it('a write with the wrong workspace is refused', async () => {
      await runWithTenant(tenant(A.ws), async () => {
        await expect(
          wrapped.lead.create({
            data: { workspaceId: B.ws, chatbotId: A.chatbot },
          }),
        ).rejects.toThrow();
      });
      expect(
        await count(
          admin as unknown as Tx,
          'leads',
          'workspace_id = $1::uuid',
          B.ws,
        ),
      ).toBe(1);
    });

    it('runAsSystem sees every workspace; leaving it restores the fail-closed state', async () => {
      const seen = await runAsSystem('rls test', () =>
        wrapped.chatbot.findMany({
          where: { workspaceId: { in: [A.ws, B.ws] } },
        }),
      );
      expect(seen.map((c) => c.workspaceId).sort()).toEqual(
        [A.ws, B.ws].sort(),
      );
      expect(await wrapped.chatbot.count()).toBe(0);
    });

    it('rejects a context that is not a workspace id', async () => {
      await runWithTenant(tenant("x'; DROP TABLE faqs; --"), async () => {
        await expect(wrapped.chatbot.count()).rejects.toThrow(
          /Invalid workspace id/,
        );
      });
    });
  });
});
