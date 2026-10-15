/**
 * Turns a visitor's question into a Postgres `to_tsquery` string that
 * matches a chunk containing ANY of its words (`time | open`). The words
 * are cut out with a letters-and-digits pattern, so nothing the visitor
 * typed can become query syntax. Returns null when there is nothing to
 * search for.
 */
export function keywordQuery(question: string): string | null {
  const words = question.toLowerCase().match(/[\p{L}\p{M}\p{N}]{2,}/gu) ?? [];
  const unique = [...new Set(words)].slice(0, 12);
  return unique.length > 0 ? unique.join(' | ') : null;
}
