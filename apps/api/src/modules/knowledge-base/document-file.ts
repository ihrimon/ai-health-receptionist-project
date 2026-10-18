import {
  DOCUMENT_EXTENSIONS,
  type DocumentExtension,
} from '@brainstack/shared';
import { BadRequestException } from '@nestjs/common';

/** The MIME type we store for each accepted extension. */
const MIME_BY_EXTENSION: Record<DocumentExtension, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

/**
 * MIME types a browser may send for each extension. Browsers disagree
 * (".md" arrives as text/markdown, text/x-markdown or text/plain), and many
 * send application/octet-stream or nothing, so those generic ones always
 * pass; the file's own bytes decide.
 */
const ACCEPTED_MIME: Record<DocumentExtension, string[]> = {
  pdf: ['application/pdf', 'application/x-pdf'],
  docx: [MIME_BY_EXTENSION.docx],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
};
const GENERIC_MIME = new Set(['', 'application/octet-stream']);

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * A .docx is a zip, and a small one can inflate to gigabytes (a zip bomb)
 * while the text is extracted inside the API process. A real document with
 * pictures stays far below these limits.
 */
export const DOCX_MAX_ENTRIES = 2000;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;

/**
 * What the zip's own central directory declares: the number of entries and
 * the total uncompressed size, or null when there is no readable directory
 * (the extractor then fails with its own message). Zip64 sizes (0xFFFFFFFF)
 * count as too large.
 */
export function zipDeclaredSize(
  file: Buffer,
): { entries: number; bytes: number } | null {
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  const from = Math.max(0, file.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = file.length - 22; i >= from; i--) {
    if (file.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = file.readUInt16LE(eocd + 10);
  let offset = file.readUInt32LE(eocd + 16);
  let bytes = 0;
  let counted = 0;
  while (counted < Math.min(entries, DOCX_MAX_ENTRIES + 1)) {
    if (offset + 46 > file.length || file.readUInt32LE(offset) !== 0x02014b50) {
      return null;
    }
    bytes += file.readUInt32LE(offset + 24);
    const nameLength = file.readUInt16LE(offset + 28);
    const extraLength = file.readUInt16LE(offset + 30);
    const commentLength = file.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
    counted++;
  }
  return { entries, bytes };
}

/** PDF: "%PDF-" near the start (some writers put a few bytes before it). */
function looksLikePdf(file: Buffer): boolean {
  return file.subarray(0, 1024).includes('%PDF-');
}

/**
 * DOCX: a zip whose file list names Word's main part. Zip file names are
 * stored uncompressed, so a byte search finds them.
 */
function looksLikeDocx(file: Buffer): boolean {
  return (
    file.subarray(0, 4).equals(ZIP_MAGIC) &&
    file.includes('[Content_Types].xml') &&
    file.includes('word/document.xml')
  );
}

function isZipBomb(file: Buffer): boolean {
  const declared = zipDeclaredSize(file);
  return (
    declared !== null &&
    (declared.entries > DOCX_MAX_ENTRIES ||
      declared.bytes > DOCX_MAX_UNCOMPRESSED_BYTES)
  );
}

/** TXT/MD: valid UTF-8 with no NUL bytes, so not a binary in disguise. */
function looksLikeText(file: Buffer): boolean {
  if (file.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(file);
    return true;
  } catch {
    return false;
  }
}

const CONTENT_CHECKS: Record<DocumentExtension, (file: Buffer) => boolean> = {
  pdf: looksLikePdf,
  docx: looksLikeDocx,
  txt: looksLikeText,
  md: looksLikeText,
};

export interface DocumentType {
  extension: DocumentExtension;
  /** Our own MIME type for the file, not the browser's claim. */
  mimeType: string;
}

function rejected(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'VALIDATION_FAILED',
    message,
  });
}

/**
 * Accepts a PDF, DOCX, TXT or MD upload (D-2 §2.3) only if its extension,
 * the browser's MIME type and the file's own bytes agree, so a renamed
 * executable or image never reaches storage or the indexer.
 */
export function checkDocumentFile(
  fileName: string,
  claimedMime: string,
  file: Buffer,
): DocumentType {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1].toLowerCase();
  if (
    !extension ||
    !(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)
  ) {
    throw rejected(
      `Upload a ${DOCUMENT_EXTENSIONS.map((e) => e.toUpperCase()).join(', ')} file`,
    );
  }
  const ext = extension as DocumentExtension;

  if (file.length === 0) throw rejected('The file is empty');

  const mime = claimedMime.split(';')[0].trim().toLowerCase();
  if (!GENERIC_MIME.has(mime) && !ACCEPTED_MIME[ext].includes(mime)) {
    throw rejected(`The file type (${mime}) doesn't match .${ext}`);
  }
  if (!CONTENT_CHECKS[ext](file)) {
    throw rejected(`The file's content isn't a valid ${ext.toUpperCase()}`);
  }
  if (ext === 'docx' && isZipBomb(file)) {
    throw rejected('The Word document is too large once unpacked');
  }
  return { extension: ext, mimeType: MIME_BY_EXTENSION[ext] };
}

/** "Return policy.pdf" → "Return policy", the default document title. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const title = base.replace(/\.[^.]+$/, '').trim();
  return (title || 'Untitled document').slice(0, 200);
}
