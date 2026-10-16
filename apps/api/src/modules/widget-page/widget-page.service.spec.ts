import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { WidgetPageCache } from './widget-page.cache';
import { WidgetPageService } from './widget-page.service';

describe('WidgetPageService', () => {
  let service: WidgetPageService;
  let cache: WidgetPageCache;
  let nodeEnv: string;
  const findUnique = jest.fn();
  const liveBot = (allowedDomains: string[]) => ({
    status: 'ENABLED',
    allowedDomains,
    publishedVersionId: 'ver-1',
    workspace: { status: 'ACTIVE' },
  });

  beforeEach(async () => {
    nodeEnv = 'development';
    findUnique.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        WidgetPageService,
        WidgetPageCache,
        { provide: PrismaService, useValue: { chatbot: { findUnique } } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'nodeEnv' ? nodeEnv : ''),
          },
        },
      ],
    }).compile();
    service = module.get(WidgetPageService);
    cache = module.get(WidgetPageCache);
  });

  it("builds frame-ancestors from the chatbot's own domains", async () => {
    findUnique.mockResolvedValue(liveBot(['shop.example.com']));

    await expect(service.frameAncestorsFor('cb_abc')).resolves.toBe(
      'https://shop.example.com',
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicId: 'cb_abc' } }),
    );
  });

  it('reads the database once, then the cache until invalidated', async () => {
    findUnique.mockResolvedValue(liveBot(['a.example.com']));
    await service.frameAncestorsFor('cb_abc');
    await service.frameAncestorsFor('cb_abc');
    expect(findUnique).toHaveBeenCalledTimes(1);

    findUnique.mockResolvedValue(liveBot(['b.example.com']));
    cache.invalidate('cb_abc');
    await expect(service.frameAncestorsFor('cb_abc')).resolves.toBe(
      'https://b.example.com',
    );
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unknown', null],
    ['switched off', { ...liveBot([]), status: 'DISABLED' }],
    ['never published', { ...liveBot([]), publishedVersionId: null }],
    [
      'in a suspended workspace',
      { ...liveBot([]), workspace: { status: 'SUSPENDED' } },
    ],
  ])(
    'is null (a 404) for a chatbot that is %s, and caches nothing',
    async (_, bot) => {
      findUnique.mockResolvedValue(bot);
      await expect(service.frameAncestorsFor('cb_abc')).resolves.toBeNull();
      expect(cache.size).toBe(0);
    },
  );

  it('answers a malformed public ID without a query', async () => {
    await expect(service.frameAncestorsFor('cb abc/..')).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ignores localhost entries in production', async () => {
    nodeEnv = 'production';
    findUnique.mockResolvedValue(liveBot(['localhost:3000']));
    await expect(service.frameAncestorsFor('cb_abc')).resolves.toBe("'none'");
  });
});
