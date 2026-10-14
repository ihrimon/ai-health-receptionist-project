import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { EmbeddingService } from './embedding.service';
import { KnowledgeService, type TenantTx } from './knowledge.service';

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
      0,
      'Within 30 days.',
      '{"title":"Returns","headingPath":[]}',
      '[0.5,0.25]',
      'Xenova/all-MiniLM-L6-v2',
    ]);
  });

  it("searches only the current workspace's chatbot", async () => {
    await inTenant(() => service.search('bot-1', 'return policy', 5));

    const [call] = db.$queryRaw.mock.calls as unknown[][];
    expect(sqlOf(call)).toContain(
      'WHERE workspace_id = ?::uuid AND chatbot_id = ?::uuid',
    );
    expect(call.slice(1)).toEqual([
      '[0.1,0.2]',
      'ws-1',
      'bot-1',
      '[0.1,0.2]',
      5,
    ]);
  });

  it('refuses to search outside a workspace', async () => {
    await expect(service.search('bot-1', 'q')).rejects.toThrow(
      'outside a workspace request',
    );
  });
});
