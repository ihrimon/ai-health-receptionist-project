import { createHash } from 'crypto';

export const FAKE_EMBEDDING_MODEL = 'test/fake-bag-of-words';
const DIMENSIONS = 384;

/**
 * Stands in for EmbeddingService in the integration tests, so CI doesn't
 * download the 90 MB MiniLM model. A hashed bag of words: texts sharing
 * words get similar vectors, which is enough to test search end to end.
 */
export const fakeEmbeddingService = {
  modelName: FAKE_EMBEDDING_MODEL,
  embed(text: string): Promise<number[]> {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      const bucket = createHash('sha1').update(word).digest().readUInt32BE(0);
      vector[bucket % DIMENSIONS] += 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return Promise.resolve(vector.map((v) => v / norm));
  },
};
