import { keywordQuery } from './keyword-query';

describe('keywordQuery', () => {
  it('joins the distinct words with OR', () => {
    expect(keywordQuery('What time do you open? Open on Sunday?')).toBe(
      'what | time | do | you | open | on | sunday',
    );
  });

  it('keeps model numbers and non-English words whole', () => {
    expect(keywordQuery('Is the ZX-9000 in stock? দাম কত')).toBe(
      'is | the | zx | 9000 | in | stock | দাম | কত',
    );
  });

  it('never lets typed characters become query syntax', () => {
    expect(keywordQuery("'; DROP TABLE x; -- & | ! ( ) :*")).toBe(
      'drop | table',
    );
  });

  it('is null when there is nothing to search for', () => {
    expect(keywordQuery('?? ! a')).toBeNull();
  });

  it('caps the number of words', () => {
    const many = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    expect(keywordQuery(many)?.split(' | ')).toHaveLength(12);
  });
});
