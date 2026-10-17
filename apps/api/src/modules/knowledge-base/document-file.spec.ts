import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import {
  checkDocumentFile,
  DOCX_MAX_ENTRIES,
  titleFromFileName,
  zipDeclaredSize,
} from './document-file';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
// The start of a real .docx: the zip signature, then the part names.
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
  Buffer.from('[Content_Types].xml ... word/document.xml ...'),
]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('photos/cat.jpg'),
]);

describe('checkDocumentFile', () => {
  it.each([
    ['manual.pdf', 'application/pdf', PDF, 'application/pdf'],
    [
      'Price list.DOCX',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      DOCX,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['notes.txt', 'text/plain', Buffer.from('Open 9 to 5.'), 'text/plain'],
    [
      'faq.md',
      'text/x-markdown',
      Buffer.from('# FAQ\n\n- যোগাযোগ'),
      'text/markdown',
    ],
    [
      'faq.md',
      'application/octet-stream',
      Buffer.from('# FAQ'),
      'text/markdown',
    ],
    ['manual.pdf', '', PDF, 'application/pdf'],
  ])('accepts %s sent as %p', (name, mime, file, stored) => {
    expect(checkDocumentFile(name, mime, file)).toEqual({
      extension: name.split('.').pop()!.toLowerCase(),
      mimeType: stored,
    });
  });

  it.each([
    ['an unsupported extension', 'photo.png', 'image/png', PNG],
    ['no extension', 'manual', 'application/pdf', PDF],
    ['an image renamed to .pdf', 'cat.pdf', 'application/pdf', PNG],
    ['a plain zip renamed to .docx', 'archive.docx', '', ZIP],
    ['a binary renamed to .txt', 'notes.txt', 'text/plain', PNG],
    [
      'invalid UTF-8 text',
      'notes.txt',
      'text/plain',
      Buffer.from([0x66, 0xff, 0xfe]),
    ],
    [
      'a MIME type that contradicts the extension',
      'manual.pdf',
      'image/png',
      PDF,
    ],
    ['an empty file', 'notes.txt', 'text/plain', Buffer.alloc(0)],
  ])('rejects %s (400)', (_, name, mime, file) => {
    expect(() => checkDocumentFile(name, mime, file)).toThrow(
      BadRequestException,
    );
  });
});

describe('titleFromFileName', () => {
  it('drops the folder and extension', () => {
    expect(titleFromFileName('C:\\docs\\Return policy.pdf')).toBe(
      'Return policy',
    );
    expect(titleFromFileName('.pdf')).toBe('Untitled document');
  });
});

describe('docx zip bombs (M7-2)', () => {
  const MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  async function docx(extraFiles = 0): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('word/document.xml', '<w:document>Hello</w:document>');
    for (let i = 0; i < extraFiles; i++) zip.file(`media/${i}.txt`, 'x');
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  /** Rewrites the declared uncompressed size of every central entry. */
  function declareSize(file: Buffer, size: number): Buffer {
    const copy = Buffer.from(file);
    for (let i = 0; i < copy.length - 4; i++) {
      if (copy.readUInt32LE(i) === 0x02014b50) copy.writeUInt32LE(size, i + 24);
    }
    return copy;
  }

  it('accepts a real, small document', async () => {
    const file = await docx();
    expect(zipDeclaredSize(file)).toEqual({
      entries: 3,
      bytes: expect.any(Number) as number,
    });
    expect(checkDocumentFile('a.docx', MIME, file).extension).toBe('docx');
  });

  it('rejects a zip that declares gigabytes of content', async () => {
    const bomb = declareSize(await docx(), 0x7fffffff);
    expect(() => checkDocumentFile('a.docx', MIME, bomb)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a zip with far too many entries', async () => {
    const many = await docx(DOCX_MAX_ENTRIES + 5);
    expect(() => checkDocumentFile('a.docx', MIME, many)).toThrow(
      BadRequestException,
    );
  });
});
