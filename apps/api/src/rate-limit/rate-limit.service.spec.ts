import type { PrismaService } from '../database/prisma.service';
import { RateLimitedException, RateLimitService } from './rate-limit.service';

interface UpsertArgs {
  where: { key_windowStart: { key: string; windowStart: Date } };
  create: { expiresAt: Date };
}

/** Fake `rate_limits`: one counter per key and window start. */
function fakePrisma() {
  const counts = new Map<string, number>();
  return {
    rateLimit: {
      upsert: jest.fn(({ where }: UpsertArgs) => {
        const { key, windowStart } = where.key_windowStart;
        const id = `${key}@${windowStart.toISOString()}`;
        const count = (counts.get(id) ?? 0) + 1;
        counts.set(id, count);
        return Promise.resolve({ count });
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('RateLimitService', () => {
  let service: RateLimitService;
  let prisma: ReturnType<typeof fakePrisma>;
  // 18 s into a minute.
  const NOW = Date.UTC(2026, 9, 14, 10, 0, 18);

  beforeEach(() => {
    prisma = fakePrisma();
    service = new RateLimitService(prisma as unknown as PrismaService);
    service.now = () => NOW;
    service.random = () => 0.5; // no cleanup
  });

  const rule = { key: 'login:x', limit: 2, windowSeconds: 60 };

  it('allows attempts up to the limit', async () => {
    await expect(service.consume(rule)).resolves.toBeUndefined();
    await expect(service.consume(rule)).resolves.toBeUndefined();
  });

  it('throws 429 with the seconds left in the window once over the limit', async () => {
    await service.consume(rule);
    await service.consume(rule);
    const err = await service.consume(rule).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedException);
    expect((err as RateLimitedException).getStatus()).toBe(429);
    expect((err as RateLimitedException).retryAfterSeconds).toBe(42);
  });

  it('counts in fixed windows aligned to the window length', async () => {
    await service.consume(rule);

    const [[args]] = prisma.rateLimit.upsert.mock.calls as [[UpsertArgs]];
    expect(args.where.key_windowStart.windowStart.toISOString()).toBe(
      '2026-10-14T10:00:00.000Z',
    );
    expect(args.create.expiresAt.toISOString()).toBe(
      '2026-10-14T10:01:00.000Z',
    );
  });

  it('starts a fresh count in the next window', async () => {
    await service.consume(rule);
    await service.consume(rule);
    service.now = () => NOW + 60_000;

    await expect(service.consume(rule)).resolves.toBeUndefined();
  });

  it('counts every rule and fails if any one is over', async () => {
    const loose = { key: 'ip:x', limit: 100, windowSeconds: 3600 };
    const tight = { key: 'ip-email:x', limit: 1, windowSeconds: 60 };
    await service.consume(loose, tight);
    await expect(service.consume(loose, tight)).rejects.toBeInstanceOf(
      RateLimitedException,
    );
    expect(prisma.rateLimit.upsert).toHaveBeenCalledTimes(4);
  });

  it('now and then deletes expired windows', async () => {
    service.random = () => 0.001;

    await service.consume(rule);

    expect(prisma.rateLimit.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(NOW) } },
    });
  });
});
