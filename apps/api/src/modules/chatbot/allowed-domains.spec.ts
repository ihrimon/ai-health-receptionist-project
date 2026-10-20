import {
  checkAllowedDomains,
  MAX_ALLOWED_DOMAINS,
  normalizeDomain,
} from '@brainstack/shared';

// The rules live in @brainstack/shared (the dashboard shows the same
// errors); they are tested here because the API is what enforces them.
describe('checkAllowedDomains', () => {
  it('accepts domains and wildcards, normalized and de-duplicated', () => {
    expect(
      checkAllowedDomains(
        [' Shop.Example.com ', '*.example.com', 'shop.example.com', ''],
        false,
      ),
    ).toEqual({ ok: true, domains: ['shop.example.com', '*.example.com'] });
  });

  // Any ordinary business domain works, whatever its ending (M7-39).
  it.each([
    'knkoglobal.com',
    'www.knkoglobal.com',
    'shop.example.org',
    'acme.net',
    'site.dev',
    'site.io',
    'site.ai',
    'site.xyz',
    'site.online',
    'site.shop',
    'site.co.uk',
    'site.com.bd',
    'my-app.vercel.app',
    '*.vercel.app',
    'my-site.netlify.app',
    'my-site.pages.dev',
    'my-site.onrender.com',
    'sub.domain.example.com',
  ])('accepts %s', (domain) => {
    expect(checkAllowedDomains([domain], false)).toEqual({
      ok: true,
      domains: [domain],
    });
  });

  it('accepts an empty list', () => {
    expect(checkAllowedDomains([], false)).toEqual({ ok: true, domains: [] });
  });

  it('strips a pasted scheme and trailing slash, never stores them', () => {
    expect(
      checkAllowedDomains(
        ['https://Shop.Example.com/', 'http://example.org', 'shop.example.com'],
        false,
      ),
    ).toEqual({ ok: true, domains: ['shop.example.com', 'example.org'] });
  });

  it.each([
    'shop.example.com/path',
    'https://shop.example.com/products',
    'ftp://shop.example.com',
    'example',
    '*.com',
    '*',
    '*.*.example.com',
    'shop.*.example.com',
    '-bad.example.com',
    'bad_name.example.com',
    '192.168.0.1',
    'shop.example.com:8080',
    'user@shop.example.com',
    'shop example.com',
  ])('rejects %s', (domain) => {
    const check = checkAllowedDomains([domain], true);
    expect(check.ok).toBe(false);
  });

  it('names each bad domain in the problems', () => {
    expect(
      checkAllowedDomains(['ok.example.com', 'shop.example.com/a'], false),
    ).toEqual({
      ok: false,
      problems: [
        {
          domain: 'shop.example.com/a',
          message: expect.stringContaining('no paths') as string,
        },
      ],
    });
  });

  it('allows localhost only when told to (outside production)', () => {
    expect(checkAllowedDomains(['localhost:3000'], true).ok).toBe(true);
    expect(checkAllowedDomains(['http://localhost:3000/'], true)).toEqual({
      ok: true,
      domains: ['localhost:3000'],
    });
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
    // Duplicates don't count towards the limit.
    expect(
      checkAllowedDomains([...many.slice(1), 's1.example.com'], false).ok,
    ).toBe(true);
  });
});

describe('normalizeDomain', () => {
  it('trims, lowercases and drops scheme and trailing slash only', () => {
    expect(normalizeDomain('  HTTPS://Shop.Example.com/ ')).toBe(
      'shop.example.com',
    );
    expect(normalizeDomain('shop.example.com/a/')).toBe('shop.example.com/a');
  });
});
