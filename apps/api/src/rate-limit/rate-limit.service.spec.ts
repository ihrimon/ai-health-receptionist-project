import { RateLimitedException, RateLimitService } from './rate-limit.service';

// Fake Redis: one counter per key; the TTL reads as 42 after the first hit.
function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    multi() {
      let key = '';
      let windowSeconds = 0;
      const chain = {
        set(k: string, _value: string, _ex: string, w: number) {
          key = k;
          windowSeconds = w;
          return chain;
        },
        incr: () => chain,
        ttl: () => chain,
        exec() {
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          return Promise.resolve([
            [null, next === 1 ? 'OK' : null],
            [null, next],
            [null, next === 1 ? windowSeconds : 42],
          ]);
        },
      };
      return chain;
    },
  };
}

describe('RateLimitService', () => {
  let service: RateLimitService;
  beforeEach(() => {
    service = new RateLimitService(fakeRedis() as never);
  });

  const rule = { key: 'login:x', limit: 2, windowSeconds: 60 };

  it('allows attempts up to the limit', async () => {
    await expect(service.consume(rule)).resolves.toBeUndefined();
    await expect(service.consume(rule)).resolves.toBeUndefined();
  });

  it('throws 429 with the remaining window once over the limit', async () => {
    await service.consume(rule);
    await service.consume(rule);
    const err = await service.consume(rule).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedException);
    expect((err as RateLimitedException).getStatus()).toBe(429);
    expect((err as RateLimitedException).retryAfterSeconds).toBe(42);
  });

  it('counts every rule and fails if any one is over', async () => {
    const loose = { key: 'ip:x', limit: 100, windowSeconds: 3600 };
    const tight = { key: 'ip-email:x', limit: 1, windowSeconds: 60 };
    await service.consume(loose, tight);
    await expect(service.consume(loose, tight)).rejects.toBeInstanceOf(
      RateLimitedException,
    );
  });
});
