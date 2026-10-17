import { extractRawText } from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { IngestError } from './ingest-error';

/** Text of a document, per page when the format has pages (PDF). */
export interface ExtractedPage {
  /** 1-based page number; absent for formats without pages. */
  page?: number;
  text: string;
}

const PDF = 'application/pdf';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * PDF limits (M7-29). The 10 MB upload cap bounds the size, not the work: a
 * small file can hold thousands of pages or a very slow-to-render page tree.
 */
export const PDF_MAX_PAGES = 500;
export const PDF_MAX_EXTRACT_MS = 30_000;

export interface PdfLimits {
  maxPages: number;
  timeoutMs: number;
}

const DEFAULT_PDF_LIMITS: PdfLimits = {
  maxPages: PDF_MAX_PAGES,
  timeoutMs: PDF_MAX_EXTRACT_MS,
};

/**
 * Extracts the text of an uploaded document (M2-11). The MIME type is the
 * one the upload check stored (M2-10), not the browser's. Failures the
 * company can fix are IngestErrors with a readable message.
 */
export async function extractDocumentText(
  file: Buffer,
  mimeType: string,
  pdfLimits: PdfLimits = DEFAULT_PDF_LIMITS,
): Promise<ExtractedPage[]> {
  const pages =
    mimeType === PDF
      ? await extractPdf(file, pdfLimits)
      : mimeType === DOCX
        ? await extractDocx(file)
        : [{ text: decodeText(file) }];

  const withText = pages.filter((p) => p.text.trim() !== '');
  if (withText.length === 0) {
    throw new IngestError(
      mimeType === PDF
        ? 'No readable text found. Scanned PDFs (pictures of pages) are not supported yet.'
        : 'The document has no text.',
    );
  }
  return withText;
}

async function extractPdf(
  file: Buffer,
  limits: PdfLimits,
): Promise<ExtractedPage[]> {
  // pdf.js may keep a reference to the buffer it's given, so it gets a copy.
  const loading = getDocumentProxy(new Uint8Array(file));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new IngestError(
            'This PDF took too long to read. Try a smaller or simpler file.',
          ),
        ),
      limits.timeoutMs,
    );
  });
  // If the timer wins, the extraction keeps running in the background; its
  // late result or error must not become an unhandled rejection.
  const work = (async () => {
    const pdf = await loading;
    if (pdf.numPages > limits.maxPages) {
      throw new IngestError(
        `This PDF has ${pdf.numPages} pages; the limit is ${limits.maxPages}. Split it into smaller files.`,
      );
    }
    return extractPdfText(pdf, { mergePages: false });
  })();
  work.catch(() => undefined);
  try {
    const { text } = await Promise.race([work, timeout]);
    return text.map((pageText, i) => ({ page: i + 1, text: pageText }));
  } catch (err) {
    if (err instanceof IngestError) throw err;
    throw new IngestError(
      "This PDF couldn't be read. It may be damaged or password-protected.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function extractDocx(file: Buffer): Promise<ExtractedPage[]> {
  try {
    const { value } = await extractRawText({ buffer: file });
    return [{ text: value }];
  } catch {
    throw new IngestError("This Word document couldn't be read.");
  }
}

/** TXT/MD: UTF-8 (checked on upload), without a byte-order mark. */
function decodeText(file: Buffer): string {
  const text = file.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
