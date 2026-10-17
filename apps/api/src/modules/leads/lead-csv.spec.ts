import type { LeadSummary } from '@brainstack/shared';
import { csvCell, leadsCsv } from './lead-csv';

describe('csvCell', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(
      `"'=HYPERLINK(""http://evil"",""x"")"`,
    );
    expect(csvCell('+8801711000000')).toBe("'+8801711000000");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });

  it('quotes commas, quotes, line breaks and edge spaces only', () => {
    expect(csvCell('Ana Rahman')).toBe('Ana Rahman');
    expect(csvCell('Dhaka, BD')).toBe('"Dhaka, BD"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a=b')).toBe('a=b');
  });
});

describe('leadsCsv', () => {
  const lead = (extra: Partial<LeadSummary>): LeadSummary => ({
    id: 'l-1',
    chatbotId: 'bot-1',
    conversationId: 'c-1',
    name: 'Ana',
    email: 'ana@example.com',
    phone: null,
    answers: [],
    sourceUrl: 'https://shop.example/wallet',
    createdAt: '2026-10-17T10:00:00.000Z',
    ...extra,
  });

  it('has fixed columns, then one per answered question, with a BOM and CRLF', () => {
    const csv = leadsCsv([
      lead({
        answers: [
          { questionId: 'budget', question: 'Your budget?', answer: '5000' },
        ],
      }),
      lead({
        id: 'l-2',
        name: '=1+1',
        conversationId: null,
        answers: [{ questionId: 'gone', question: null, answer: 'blue' }],
      }),
    ]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Captured at (UTC),Name,Email,Phone,Source page,Conversation ID,Your budget?,Question gone',
      '2026-10-17T10:00:00.000Z,Ana,ana@example.com,,https://shop.example/wallet,c-1,5000,',
      "2026-10-17T10:00:00.000Z,'=1+1,ana@example.com,,https://shop.example/wallet,,,blue",
      '',
    ]);
  });

  it('is only the header when there are no leads', () => {
    expect(leadsCsv([])).toBe(
      '\uFEFFCaptured at (UTC),Name,Email,Phone,Source page,Conversation ID\r\n',
    );
  });
});
