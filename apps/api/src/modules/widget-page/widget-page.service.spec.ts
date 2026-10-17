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
  const updateMany = jest.fn();
  const liveBot = (allowedDomains: string[]) => ({
    status: 'ENABLED',
    allowedDomains,
    publishedVersionId: 'ver-1',
    installVerifiedAt: null as Date | null,
    workspace: { status: 'ACTIVE' },
  });

  const ancestorsFor = async (publicId: string) =>
    (await service.pageFor(publicId))?.ancestors ?? null;

  beforeEach(async () => {
    nodeEnv = 'development';
    findUnique.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [
        WidgetPageService,
        WidgetPageCache,
        {
          provide: PrismaService,
          useValue: { chatbot: { findUnique, updateMany } },
        },
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

    await expect(ancestorsFor('cb_abc')).resolves.toBe(
      'https://shop.example.com',
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicId: 'cb_abc' } }),
    );
  });

  it('reads the database once, then the cache until invalidated', async () => {
    findUnique.mockResolvedValue(liveBot(['a.example.com']));
    await ancestorsFor('cb_abc');
    await ancestorsFor('cb_abc');
    expect(findUnique).toHaveBeenCalledTimes(1);

    findUnique.mockResolvedValue(liveBot(['b.example.com']));
    cache.invalidate('cb_abc');
    await expect(ancestorsFor('cb_abc')).resolves.toBe('https://b.example.com');
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
      await expect(ancestorsFor('cb_abc')).resolves.toBeNull();
      expect(cache.size).toBe(0);
    },
  );

  it('answers a malformed public ID without a query', async () => {
    await expect(ancestorsFor('cb abc/..')).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ignores localhost entries in production', async () => {
    nodeEnv = 'production';
    findUnique.mockResolvedValue(liveBot(['localhost:3000']));
    await expect(ancestorsFor('cb_abc')).resolves.toBe("'none'");
  });

  describe('recordInstall (M4-14)', () => {
    const framed = {
      referer: 'https://shop.example.com/',
      fetchDest: 'iframe',
    };

    it('records the first load framed by an allowed site, then skips the write', async () => {
      findUnique.mockResolvedValue(liveBot(['shop.example.com']));
      const page = (await service.pageFor('cb_abc'))!;
      await service.recordInstall('cb_abc', page, framed);

      expect(updateMany).toHaveBeenCalledWith({
        where: { publicId: 'cb_abc', installVerifiedAt: null },
        data: {
          installVerifiedAt: expect.any(Date) as Date,
          installVerifiedHost: 'shop.example.com',
        },
      });
      const again = (await service.pageFor('cb_abc'))!;
      expect(again.installed).toBe(true);
      await service.recordInstall('cb_abc', again, framed);
      expect(updateMany).toHaveBeenCalledTimes(1);
    });

    it('writes nothing for an unlisted site or an already verified chatbot', async () => {
      findUnique.mockResolvedValue(liveBot(['shop.example.com']));
      const page = (await service.pageFor('cb_abc'))!;
      await service.recordInstall('cb_abc', page, {
        referer: 'https://evil.example.net/',
      });
      await service.recordInstall('cb_abc', page, {});

      cache.invalidate('cb_abc');
      findUnique.mockResolvedValue({
        ...liveBot(['shop.example.com']),
        installVerifiedAt: new Date(),
      });
      await service.recordInstall(
        'cb_abc',
        (await service.pageFor('cb_abc'))!,
        framed,
      );
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('never breaks the page when the write fails', async () => {
      findUnique.mockResolvedValue(liveBot(['shop.example.com']));
      updateMany.mockRejectedValue(new Error('db down'));
      const page = (await service.pageFor('cb_abc'))!;
      await expect(
        service.recordInstall('cb_abc', page, framed),
      ).resolves.toBeUndefined();
      expect((await service.pageFor('cb_abc'))!.installed).toBe(false);
    });
  });
});
