import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  chunkText,
  MAX_CHUNKS_PER_SOURCE,
} from './chunk-text';
import { IngestError } from './ingest-error';

const words = (n: number, word = 'word') =>
  Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

describe('chunkText', () => {
  it('keeps a short page as one chunk', () => {
    expect(chunkText([{ text: 'Open 9 to 5.' }], 'Hours')).toEqual([
      {
        content: 'Open 9 to 5.',
        metadata: { title: 'Hours', headingPath: [] },
      },
    ]);
  });

  it('splits at Markdown headings and labels each chunk with them', () => {
    const chunks = chunkText(
      [
        {
          text: '# Policies\n\n## Returns\n\nWithin 30 days.\n\n## Shipping\n\nFree over $50.',
        },
      ],
      'Store policies',
    );

    expect(chunks).toEqual([
      {
        content: 'Policies › Returns\nWithin 30 days.',
        metadata: {
          title: 'Store policies',
          headingPath: ['Policies', 'Returns'],
        },
      },
      {
        content: 'Policies › Shipping\nFree over $50.',
        metadata: {
          title: 'Store policies',
          headingPath: ['Policies', 'Shipping'],
        },
      },
    ]);
  });

  it('records the PDF page each chunk starts on', () => {
    const chunks = chunkText(
      [
        { page: 1, text: 'Page one text.' },
        { page: 2, text: 'Page two text.' },
      ],
      'Manual',
    );
    expect(chunks.map((c) => c.metadata.page)).toEqual([1, 2]);
  });

  it('keeps every chunk under the limit, with overlap between neighbours', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) =>
      words(30, `p${i}w`),
    );
    const chunks = chunkText([{ text: paragraphs.join('\n\n') }], 'Long');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
    // The start of each chunk repeats the end of the one before it.
    for (let i = 1; i < chunks.length; i++) {
      const firstWord = chunks[i].content.split(/\s/)[0];
      expect(chunks[i - 1].content).toContain(firstWord);
    }
    // Nothing is lost: every paragraph's last word is in some chunk.
    for (const p of paragraphs) {
      const last = p.split(' ').pop()!;
      expect(chunks.some((c) => c.content.includes(last))).toBe(true);
    }
  });

  it('cuts a huge paragraph with no sentence breaks at word boundaries', () => {
    const chunks = chunkText([{ text: words(600) }], 'Wall of text');
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.content).toMatch(/^word\d+/);
      expect(chunk.content).toMatch(/word\d+$/);
    }
    expect(CHUNK_OVERLAP_CHARS).toBeLessThan(CHUNK_MAX_CHARS);
  });

  it('refuses a document that would make too many chunks', () => {
    const huge = Array.from({ length: MAX_CHUNKS_PER_SOURCE + 10 }, () =>
      'x'.repeat(900),
    ).join('\n\n');
    expect(() => chunkText([{ text: huge }], 'Huge')).toThrow(IngestError);
  });

  it('makes no chunks from blank text', () => {
    expect(chunkText([{ text: '# Only a heading\n\n  \n' }], 'Empty')).toEqual(
      [],
    );
  });
});
