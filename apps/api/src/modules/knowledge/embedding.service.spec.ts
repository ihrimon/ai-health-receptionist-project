import type { ConfigService } from '@nestjs/config';
import { EMBED_CACHE_SIZE, EmbeddingService } from './embedding.service';

/** A service whose model is a counter, so tests see when it really runs. */
function makeService() {
  const service = new EmbeddingService({
    get: () => undefined,
  } as unknown as ConfigService);
  const embedder = jest.fn((text: string) =>
    Promise.resolve({ data: [text.length, 1] }),
  );
  (
    service as unknown as { embedderPromise: Promise<unknown> }
  ).embedderPromise = Promise.resolve(embedder);
  return { service, embedder };
}

describe('EmbeddingService cache (M7-32)', () => {
  it('embeds the same question once, ignoring surrounding and repeated spaces', async () => {
    const { service, embedder } = makeService();
    const first = await service.embed('opening hours?');
    const second = await service.embed('  opening   hours? ');
    expect(second).toEqual(first);
    expect(embedder).toHaveBeenCalledTimes(1);
  });

  it('keeps a different question apart', async () => {
    const { service, embedder } = makeService();
    await service.embed('opening hours?');
    await service.embed('return policy?');
    expect(embedder).toHaveBeenCalledTimes(2);
  });

  it('hands out copies, so one caller cannot change what another gets', async () => {
    const { service } = makeService();
    const first = await service.embed('hello');
    first[0] = 999;
    expect((await service.embed('hello'))[0]).toBe(5);
  });

  it('forgets the least recently used question beyond the size limit', async () => {
    const { service, embedder } = makeService();
    await service.embed('q0');
    for (let i = 1; i <= EMBED_CACHE_SIZE; i++) await service.embed(`q${i}`);
    expect(embedder).toHaveBeenCalledTimes(EMBED_CACHE_SIZE + 1);
    await service.embed('q0');
    expect(embedder).toHaveBeenCalledTimes(EMBED_CACHE_SIZE + 2);
    await service.embed(`q${EMBED_CACHE_SIZE}`);
    expect(embedder).toHaveBeenCalledTimes(EMBED_CACHE_SIZE + 2);
  });
});
