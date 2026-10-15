import JSZip from 'jszip';
import { IngestError } from './ingest-error';
import { extractDocumentText } from './text-extract';

/** A minimal one-font PDF with one line of text per page. */
function pdfWithPages(...lines: string[]): Buffer {
  const objects: string[] = [];
  const kids = lines.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push('<</Type/Catalog/Pages 2 0 R>>');
  objects.push(`<</Type/Pages/Kids[${kids}]/Count ${lines.length}>>`);
  const font = 3 + lines.length * 2;
  lines.forEach((line, i) => {
    const stream = `BT /F1 18 Tf 20 100 Td (${line}) Tj ET`;
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents ${4 + i * 2} 0 R/Resources<</Font<</F1 ${font} 0 R>>>>>>`,
    );
    objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  });
  objects.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A minimal real .docx: the parts Word needs for one paragraph. */
async function docxWith(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('extractDocumentText', () => {
  it('reads a PDF page by page', async () => {
    const pages = await extractDocumentText(
      pdfWithPages('Returns within 30 days', 'Shipping is free'),
      'application/pdf',
    );
    expect(pages).toEqual([
      {
        page: 1,
        text: expect.stringContaining('Returns within 30 days') as unknown,
      },
      { page: 2, text: expect.stringContaining('Shipping is free') as unknown },
    ]);
  });

  it('reads a Word document', async () => {
    const pages = await extractDocumentText(
      await docxWith('We open at 9am.'),
      DOCX,
    );
    expect(pages).toEqual([
      { text: expect.stringContaining('We open at 9am.') as unknown },
    ]);
  });

  it('reads text and Markdown, without a byte-order mark', async () => {
    const pages = await extractDocumentText(
      Buffer.from('﻿# FAQ\n\nযোগাযোগ: 9am'),
      'text/markdown',
    );
    expect(pages).toEqual([{ text: '# FAQ\n\nযোগাযোগ: 9am' }]);
  });

  it('explains a PDF with no text (a scan)', async () => {
    await expect(
      extractDocumentText(pdfWithPages(''), 'application/pdf'),
    ).rejects.toThrow(
      new IngestError(
        'No readable text found. Scanned PDFs (pictures of pages) are not supported yet.',
      ),
    );
  });

  it('explains a damaged PDF or Word file', async () => {
    await expect(
      extractDocumentText(Buffer.from('%PDF-1.4 garbage'), 'application/pdf'),
    ).rejects.toBeInstanceOf(IngestError);
    await expect(
      extractDocumentText(Buffer.from('PK\x03\x04 not a zip'), DOCX),
    ).rejects.toBeInstanceOf(IngestError);
  });

  it('rejects an empty text file', async () => {
    await expect(
      extractDocumentText(Buffer.from('  \n '), 'text/plain'),
    ).rejects.toThrow('The document has no text.');
  });
});
