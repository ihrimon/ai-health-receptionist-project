import { BadRequestException } from '@nestjs/common';
import { checkDocumentFile, titleFromFileName } from './document-file';

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
