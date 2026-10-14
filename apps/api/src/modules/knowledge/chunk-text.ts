import { IngestError } from './ingest-error';
import type { ExtractedPage } from './text-extract';

/** Where a chunk came from, for citing it in answers (M3). */
export interface ChunkMetadata {
  title: string;
  /** Markdown headings above the chunk, outermost first. */
  headingPath: string[];
  /** PDF page the chunk starts on. */
  page?: number;
}

export interface TextChunk {
  content: string;
  metadata: ChunkMetadata;
}

/**
 * Size of one chunk. MiniLM (T7) reads about 256 tokens, roughly 1,000
 * characters of English; longer text would be cut off before embedding.
 */
export const CHUNK_MAX_CHARS = 1000;
/** Text repeated from the previous chunk, so a sentence split across two
 * chunks is still found whole in one of them. */
export const CHUNK_OVERLAP_CHARS = 150;
/**
 * Embedding runs locally, a few chunks per second; past this a source
 * would tie up indexing for minutes. A 10 MB text file is ~10,000 chunks.
 */
export const MAX_CHUNKS_PER_SOURCE = 1500;

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
// Sentence ends, including the Bangla dari (।), followed by space.
const SENTENCE_END = /(?<=[.!?।])\s+/;

interface Section {
  headingPath: string[];
  page?: number;
  text: string;
}

/** Splits pages into sections at Markdown headings. */
function sections(pages: ExtractedPage[]): Section[] {
  const out: Section[] = [];
  const headings: string[] = [];
  let current: Section | undefined;
  for (const { page, text } of pages) {
    // A new page starts a new section, so each chunk has one start page.
    current = undefined;
    for (const line of text.split(/\r?\n/)) {
      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1].length;
        headings.splice(level - 1, headings.length, heading[2]);
        current = undefined;
        continue;
      }
      if (!current) {
        current = { headingPath: [...headings], page, text: '' };
        out.push(current);
      }
      current.text += `${line}\n`;
    }
  }
  return out.filter((s) => s.text.trim() !== '');
}

/** Breaks text into pieces of at most `max` characters, at the gentlest
 * boundary available: paragraph, then sentence, then word, then anywhere. */
function pieces(text: string, max: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length <= max) {
      out.push(trimmed);
      continue;
    }
    for (const sentence of trimmed.split(SENTENCE_END)) {
      if (sentence.length <= max) {
        out.push(sentence);
        continue;
      }
      let rest = sentence;
      while (rest.length > max) {
        const space = rest.lastIndexOf(' ', max);
        const cut = space > max / 2 ? space : max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
    }
  }
  return out;
}

/** The last `chars` characters of a chunk, starting at a word. */
function tail(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const start = text.indexOf(' ', text.length - chars);
  return start < 0 ? '' : text.slice(start + 1);
}

/**
 * Splits a document into chunks for embedding (M2-11): by Markdown heading,
 * then into pieces of up to CHUNK_MAX_CHARS joined paragraph by paragraph,
 * with a little overlap between neighbours. Each chunk starts with its
 * headings, so a chunk like "30 days." still says what it's about.
 */
export function chunkText(pages: ExtractedPage[], title: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const section of sections(pages)) {
    const label = section.headingPath.join(' › ');
    // Room for the heading line, so the whole chunk stays under the max.
    const budget = Math.max(
      CHUNK_MAX_CHARS - (label ? label.length + 1 : 0),
      CHUNK_MAX_CHARS / 2,
    );
    const metadata: ChunkMetadata = {
      title,
      headingPath: section.headingPath,
      ...(section.page !== undefined && { page: section.page }),
    };

    let body = '';
    const flush = () => {
      if (!body) return;
      chunks.push({ content: label ? `${label}\n${body}` : body, metadata });
      if (chunks.length > MAX_CHUNKS_PER_SOURCE) {
        throw new IngestError(
          `This document is too long to index (over ${MAX_CHUNKS_PER_SOURCE} parts). Split it into smaller files.`,
        );
      }
    };
    for (const piece of pieces(section.text, budget - CHUNK_OVERLAP_CHARS)) {
      const joined = body ? `${body}\n\n${piece}` : piece;
      if (joined.length <= budget) {
        body = joined;
        continue;
      }
      flush();
      const overlap = tail(body, CHUNK_OVERLAP_CHARS);
      body = overlap ? `${overlap}\n\n${piece}` : piece;
    }
    flush();
  }
  return chunks;
}
