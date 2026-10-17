import type { LeadSummary } from '@brainstack/shared';

/**
 * Spreadsheet apps run a cell that starts with one of these as a formula
 * (CSV injection, OWASP). A visitor typed these values, so such a cell gets
 * a leading apostrophe and is shown as plain text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-safe, quoted when needed (RFC 4180). */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim()
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function csvRow(cells: (string | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

const FIXED_COLUMNS = [
  'Captured at (UTC)',
  'Name',
  'Email',
  'Phone',
  'Source page',
  'Conversation ID',
];

/**
 * The leads export (FR-8.2): one row per lead, fixed columns first, then
 * one column per question that any exported lead answered, headed by the
 * question as the chatbot asks it now. Starts with a byte-order mark so
 * Excel reads it as UTF-8 (names in Bangla stay readable). CRLF line ends.
 */
export function leadsCsv(leads: LeadSummary[]): string {
  const questions = new Map<string, string>();
  for (const lead of leads) {
    for (const a of lead.answers) {
      if (!questions.has(a.questionId) || a.question) {
        questions.set(a.questionId, a.question ?? `Question ${a.questionId}`);
      }
    }
  }
  const questionIds = [...questions.keys()];

  const lines = [
    csvRow([...FIXED_COLUMNS, ...questions.values()]),
    ...leads.map((lead) => {
      const answers = new Map(
        lead.answers.map((a) => [a.questionId, a.answer]),
      );
      return csvRow([
        lead.createdAt,
        lead.name,
        lead.email,
        lead.phone,
        lead.sourceUrl,
        lead.conversationId,
        ...questionIds.map((id) => answers.get(id)),
      ]);
    }),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
