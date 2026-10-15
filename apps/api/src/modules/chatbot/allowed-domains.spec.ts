import { checkAllowedDomains, MAX_ALLOWED_DOMAINS } from './allowed-domains';

describe('checkAllowedDomains', () => {
  it('accepts domains and wildcards, normalized and de-duplicated', () => {
    expect(
      checkAllowedDomains(
        [' Shop.Example.com ', '*.example.com', 'shop.example.com', ''],
        false,
      ),
    ).toEqual({ ok: true, domains: ['shop.example.com', '*.example.com'] });
  });

  it('accepts an empty list', () => {
    expect(checkAllowedDomains([], false)).toEqual({ ok: true, domains: [] });
  });

  it.each([
    'https://shop.example.com',
    'shop.example.com/path',
    'example',
    '*.com',
    '*',
    '-bad.example.com',
    '192.168.0.1',
    'shop.example.com:8080',
  ])('rejects %s', (domain) => {
    const check = checkAllowedDomains([domain], true);
    expect(check.ok).toBe(false);
  });

  it('allows localhost only when told to (outside production)', () => {
    expect(checkAllowedDomains(['localhost:3000'], true).ok).toBe(true);
    expect(checkAllowedDomains(['localhost'], false)).toEqual({
      ok: false,
      problems: [
        {
          domain: 'localhost',
          message: 'localhost is only allowed in development',
        },
      ],
    });
  });

  it(`allows at most ${MAX_ALLOWED_DOMAINS} domains`, () => {
    const many = Array.from(
      { length: MAX_ALLOWED_DOMAINS + 1 },
      (_, i) => `s${i}.example.com`,
    );
    expect(checkAllowedDomains(many, false).ok).toBe(false);
    expect(checkAllowedDomains(many.slice(1), false).ok).toBe(true);
  });
});
