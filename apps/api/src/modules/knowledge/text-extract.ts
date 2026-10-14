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
 * Extracts the text of an uploaded document (M2-11). The MIME type is the
 * one the upload check stored (M2-10), not the browser's. Failures the
 * company can fix are IngestErrors with a readable message.
 */
export async function extractDocumentText(
  file: Buffer,
  mimeType: string,
): Promise<ExtractedPage[]> {
  const pages =
    mimeType === PDF
      ? await extractPdf(file)
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

async function extractPdf(file: Buffer): Promise<ExtractedPage[]> {
  let text: string[];
  try {
    // pdf.js may keep a reference to the buffer it's given, so it gets a copy.
    const pdf = await getDocumentProxy(new Uint8Array(file));
    ({ text } = await extractPdfText(pdf, { mergePages: false }));
  } catch {
    throw new IngestError(
      "This PDF couldn't be read. It may be damaged or password-protected.",
    );
  }
  return text.map((pageText, i) => ({ page: i + 1, text: pageText }));
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
