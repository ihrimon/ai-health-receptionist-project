import { IngestError } from './ingest-error';
import { extractDocumentText } from './text-extract';

// A parser that never answers stands in for a PDF that is very slow to read.
jest.mock('unpdf', () => ({
  getDocumentProxy: jest.fn(() => Promise.resolve({ numPages: 1 })),
  extractText: jest.fn(() => new Promise(() => undefined)),
}));

describe('extractDocumentText, PDF time limit (M7-29)', () => {
  it('gives up with a clear message instead of hanging', async () => {
    const started = Date.now();
    await expect(
      extractDocumentText(Buffer.from('%PDF-1.4'), 'application/pdf', {
        maxPages: 500,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(
      new IngestError(
        'This PDF took too long to read. Try a smaller or simpler file.',
      ),
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
