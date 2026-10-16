import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { EmbeddingService } from './embedding.service';
import {
  isRelevant,
  KnowledgeService,
  type TenantTx,
} from './knowledge.service';

/** A tagged-template call's SQL text, with "?" where the values go. */
const sqlOf = (call: unknown[]) =>
  (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ');

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'user-1', role: 'ADMIN' }, fn);

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let db: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    db = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const module = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        {
          provide: EmbeddingService,
          useValue: {
            modelName: 'Xenova/all-MiniLM-L6-v2',
            embed: jest.fn().mockResolvedValue([0.1, 0.2]),
          },
        },
        { provide: TENANT_PRISMA, useValue: db },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get(KnowledgeService);
  });

  it("replaces a source's chunks inside the caller's transaction", async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };

    await inTenant(() =>
      service.replaceSourceChunks(tx as unknown as TenantTx, 'bot-1', 'src-1', [
        {
          content: 'Within 30 days.',
          metadata: { title: 'Returns', headingPath: [] },
          embedding: [0.5, 0.25],
        },
      ]),
    );

    const [del, ins] = tx.$executeRaw.mock.calls as unknown[][];
    expect(sqlOf(del)).toContain(
      'DELETE FROM knowledge_chunks WHERE source_id = ?::uuid AND workspace_id = ?::uuid',
    );
    expect(del.slice(1)).toEqual(['src-1', 'ws-1']);
    expect(sqlOf(ins)).toContain('INSERT INTO knowledge_chunks');
    expect(ins.slice(1)).toEqual([
      'ws-1',
      'bot-1',
      'src-1',
      null,
      0,
      'Within 30 days.',
      '{"title":"Returns","headingPath":[]}',
      '[0.5,0.25]',
      'Xenova/all-MiniLM-L6-v2',
    ]);
  });

  it("replaces an FAQ's chunks, linked by faq_id", async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };

    await inTenant(() =>
      service.replaceFaqChunks(tx as unknown as TenantTx, 'bot-1', 'faq-1', [
        {
          content: 'Q\n\nA',
          metadata: { title: 'Q', headingPath: [] },
          embedding: [1],
        },
      ]),
    );

    const [del, ins] = tx.$executeRaw.mock.calls as unknown[][];
    expect(sqlOf(del)).toContain(
      'WHERE faq_id = ?::uuid AND workspace_id = ?::uuid',
    );
    expect(del.slice(1)).toEqual(['faq-1', 'ws-1']);
    expect(ins.slice(1, 5)).toEqual(['ws-1', 'bot-1', null, 'faq-1']);
  });

  it.each([
    ['setCustomAnswerEmbedding', 'custom_answers'],
    ['setProductEmbedding', 'products'],
  ] as const)(
    '%s writes the row embedding in the current workspace',
    async (method, table) => {
      const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };

      await inTenant(() =>
        service[method](tx as unknown as TenantTx, 'row-1', [0.5]),
      );

      const [call] = tx.$executeRaw.mock.calls as unknown[][];
      expect(sqlOf(call)).toContain(`UPDATE ${table}`);
      expect(sqlOf(call)).toContain(
        'WHERE id = ?::uuid AND workspace_id = ?::uuid',
      );
      expect(call.slice(1)).toEqual([
        '[0.5]',
        'Xenova/all-MiniLM-L6-v2',
        'row-1',
        'ws-1',
      ]);
    },
  );

  it("searches only the current workspace's chatbot, in both the meaning and the keyword search", async () => {
    await inTenant(() => service.search('bot-1', 'return policy', 5));

    const [call] = db.$queryRaw.mock.calls as unknown[][];
    const sql = sqlOf(call);
    // meaning search, keyword search and the final join each add the workspace.
    expect(sql.split('workspace_id = ?::uuid')).toHaveLength(4);
    expect(sql.split('chatbot_id = ?::uuid')).toHaveLength(4);
    const params = call.slice(1);
    expect(params.filter((p) => p === 'ws-1')).toHaveLength(3);
    expect(params.filter((p) => p === 'bot-1')).toHaveLength(3);
    // The words are passed as a bound parameter, never as SQL text.
    expect(params).toContain('return | policy');
    expect(sql).not.toContain('return | policy');
    expect(params).toContain(5);
  });

  it('searches by meaning only when the question has no words', async () => {
    await inTenant(() => service.search('bot-1', '??', 3));

    const [call] = db.$queryRaw.mock.calls as unknown[][];
    expect(call.slice(1)).toContain('');
  });

  it('refuses to search outside a workspace', async () => {
    await expect(service.search('bot-1', 'q')).rejects.toThrow(
      'outside a workspace request',
    );
  });

  describe('isRelevant (M3-10)', () => {
    it('keeps a keyword hit even when the meaning is far', () => {
      expect(isRelevant({ keywordHit: true, similarity: 0.05 }, 0.3)).toBe(
        true,
      );
    });

    it('keeps a chunk that is close enough in meaning', () => {
      expect(isRelevant({ keywordHit: false, similarity: 0.42 }, 0.3)).toBe(
        true,
      );
      expect(isRelevant({ keywordHit: false, similarity: 0.3 }, 0.3)).toBe(
        true,
      );
    });

    it('drops a chunk that is neither', () => {
      expect(isRelevant({ keywordHit: false, similarity: 0.12 }, 0.3)).toBe(
        false,
      );
    });
  });

  describe('matchCustomAnswer (M3-6)', () => {
    const row = {
      id: 'ca-1',
      triggerQuestion: 'Do you open on Eid?',
      answer: 'We are closed on Eid.',
    };

    it('returns the closest active answer when it is close enough', async () => {
      db.$queryRaw.mockResolvedValue([{ ...row, similarity: 0.93 }]);

      await expect(
        inTenant(() => service.matchCustomAnswer('bot-1', 'open on eid?')),
      ).resolves.toEqual({ ...row, similarity: 0.93 });

      const [call] = db.$queryRaw.mock.calls as unknown[][];
      const sql = sqlOf(call);
      expect(sql).toContain('workspace_id = ?::uuid AND chatbot_id = ?::uuid');
      expect(sql).toContain('is_active');
      expect(sql).toContain('embedding_model = ?');
      expect(call.slice(1)).toContain('ws-1');
      expect(call.slice(1)).toContain('bot-1');
    });

    it('is null when the closest answer is below the threshold', async () => {
      db.$queryRaw.mockResolvedValue([{ ...row, similarity: 0.55 }]);
      await expect(
        inTenant(() => service.matchCustomAnswer('bot-1', 'something else')),
      ).resolves.toBeNull();
    });

    it('is null when the chatbot has no custom answers', async () => {
      db.$queryRaw.mockResolvedValue([]);
      await expect(
        inTenant(() => service.matchCustomAnswer('bot-1', 'anything')),
      ).resolves.toBeNull();
    });

    it('uses a vector it is given instead of embedding again', async () => {
      db.$queryRaw.mockResolvedValue([]);
      await inTenant(() =>
        service.matchCustomAnswer('bot-1', 'anything', [0.7, 0.8]),
      );
      const [call] = db.$queryRaw.mock.calls as unknown[][];
      expect(call.slice(1)).toContain('[0.7,0.8]');
    });
  });

  describe('searchProducts (M3-8)', () => {
    it('searches only active products of the chatbot in the workspace', async () => {
      db.$queryRaw.mockResolvedValue([]);

      await inTenant(() =>
        service.searchProducts(
          'bot-1',
          { query: 'trail shoe', category: 'Shoes', maxPrice: 60 },
          5,
        ),
      );

      const [call] = db.$queryRaw.mock.calls as unknown[][];
      const sql = sqlOf(call);
      expect(sql).toContain('workspace_id = ?::uuid AND chatbot_id = ?::uuid');
      expect(sql).toContain('AND is_active');
      // The final join adds them again.
      expect(sql.split('workspace_id = ?::uuid').length).toBeGreaterThanOrEqual(
        3,
      );
      const params = call.slice(1);
      expect(params).toContain('ws-1');
      expect(params).toContain('bot-1');
      expect(params).toContain('Shoes');
      expect(params).toContain(60);
      expect(params).toContain('trail | shoe');
      // Values are bound, never part of the SQL text.
      expect(sql).not.toContain('Shoes');
    });
  });
});
