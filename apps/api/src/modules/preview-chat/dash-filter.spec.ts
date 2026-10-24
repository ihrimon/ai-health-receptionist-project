import { EmDashFilter, withoutEmDashes } from './dash-filter';

const stream = (pieces: string[]) => {
  const filter = new EmDashFilter();
  return pieces.map((p) => filter.push(p)).join('');
};

describe('withoutEmDashes', () => {
  it('turns a spaced or unspaced em dash into a comma', () => {
    expect(withoutEmDashes('Fast — and cheap')).toBe('Fast, and cheap');
    expect(withoutEmDashes('Fast—and cheap')).toBe('Fast, and cheap');
  });

  it('leaves hyphens and en dashes alone', () => {
    expect(withoutEmDashes('1-5 pages, 9–5 hours')).toBe(
      '1-5 pages, 9–5 hours',
    );
  });
});

describe('EmDashFilter', () => {
  it('gives the same text however the pieces are cut', () => {
    const text = 'Plans start low — about $99 a month — and grow.';
    const expected = 'Plans start low, about $99 a month, and grow.';
    expect(stream([text])).toBe(expected);
    expect(stream(text.split(''))).toBe(expected);
    expect(
      stream([
        'Plans start low ',
        '—',
        ' about $99 a month ',
        '— ',
        'and grow.',
      ]),
    ).toBe(expected);
  });

  it('keeps the spaces between ordinary words', () => {
    expect(stream(['Hello ', 'there ', 'friend'])).toBe('Hello there friend');
  });
});
