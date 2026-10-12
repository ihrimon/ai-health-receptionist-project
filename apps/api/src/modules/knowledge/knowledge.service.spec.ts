import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { EmbeddingService } from './embedding.service';
import { KnowledgeService } from './knowledge.service';

/** Joins a tagged-template call's SQL parts, for asserting on the query text. */
function sqlOf(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join('?');
}

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let embeddingService: { embed: jest.Mock };
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    embeddingService = { embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockReturnValue('pending-statement'),
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: EmbeddingService, useValue: embeddingService },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    service = module.get<KnowledgeService>(KnowledgeService);
  });

  it('embeds the query and searches by cosine distance, defaulting topK to 3', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { source: 'faq.md', content: 'We are open 9-5.', similarity: 0.9 },
    ]);

    const results = await service.search('what are your hours?');

    expect(embeddingService.embed).toHaveBeenCalledWith('what are your hours?');
    const call = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toContain('ORDER BY embedding <=>');
    expect(call.slice(1)).toEqual(['[0.1,0.2,0.3]', '[0.1,0.2,0.3]', 3]);
    expect(results).toEqual([
      { source: 'faq.md', content: 'We are open 9-5.', similarity: 0.9 },
    ]);
  });

  it('replaceAll clears existing rows and inserts an embedded row per chunk in one transaction', async () => {
    await service.replaceAll([
      { source: 'faq.md', content: 'Chunk one' },
      { source: 'faq.md', content: 'Chunk two' },
    ]);

    const calls = prisma.$executeRaw.mock.calls as unknown[][];
    expect(calls).toHaveLength(3);
    expect(sqlOf(calls[0])).toContain('DELETE FROM knowledge_chunks');
    expect(sqlOf(calls[1])).toContain('INSERT INTO knowledge_chunks');
    expect(calls[1].slice(1)).toEqual(['faq.md', 'Chunk one', '[0.1,0.2,0.3]']);
    expect(calls[2].slice(1)).toEqual(['faq.md', 'Chunk two', '[0.1,0.2,0.3]']);
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'pending-statement',
      'pending-statement',
      'pending-statement',
    ]);
  });

  it('replaceAll leaves the table untouched if embedding fails', async () => {
    embeddingService.embed.mockRejectedValue(new Error('model load failed'));

    await expect(
      service.replaceAll([{ source: 'faq.md', content: 'Chunk one' }]),
    ).rejects.toThrow('model load failed');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
