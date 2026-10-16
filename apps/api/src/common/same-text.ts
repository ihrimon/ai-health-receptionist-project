/**
 * Text with the differences that don't change what it says removed: case,
 * typographic quotes and dashes, non-breaking spaces, runs of spaces and a
 * closing full stop. Models love to "improve" these.
 */
export function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!\s]+$/, '');
}

export function sameText(a: string, b: string): boolean {
  return plain(a) === plain(b);
}
