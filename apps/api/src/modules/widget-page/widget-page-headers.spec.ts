import { frameAncestors, widgetPageHeaders } from './widget-page-headers';

describe('frameAncestors', () => {
  it('allows each listed domain over https', () => {
    expect(frameAncestors(['shop.example.com', 'example.org'], false)).toBe(
      'https://shop.example.com https://example.org',
    );
  });

  it('keeps a wildcard for subdomains only', () => {
    expect(frameAncestors(['*.example.com'], false)).toBe(
      'https://*.example.com',
    );
  });

  it("is 'none' for an empty list, so no site can frame the page", () => {
    expect(frameAncestors([], false)).toBe("'none'");
  });

  it('allows localhost over http and https outside production', () => {
    expect(frameAncestors(['localhost:3000'], true)).toBe(
      'http://localhost:3000 https://localhost:3000',
    );
    expect(frameAncestors(['localhost'], true)).toBe(
      'http://localhost:* https://localhost:*',
    );
  });

  it('drops localhost in production', () => {
    expect(frameAncestors(['localhost:3000'], false)).toBe("'none'");
    expect(frameAncestors(['localhost', 'shop.example.com'], false)).toBe(
      'https://shop.example.com',
    );
  });

  it('skips a value that could add a directive (hand-edited row)', () => {
    expect(
      frameAncestors(['evil.com; script-src *', 'ok.example.com'], false),
    ).toBe('https://ok.example.com');
    expect(frameAncestors(["'self'", '*'], false)).toBe("'none'");
  });

  it('lists a domain once', () => {
    expect(frameAncestors(['a.example.com', 'a.example.com'], false)).toBe(
      'https://a.example.com',
    );
  });
});

describe('widgetPageHeaders', () => {
  it('puts frame-ancestors in a strict CSP with the other headers', () => {
    const headers = widgetPageHeaders('https://shop.example.com');
    const csp = headers['Content-Security-Policy'];

    expect(csp).toContain('frame-ancestors https://shop.example.com');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('unsafe');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Cache-Control']).toBe('no-cache');
  });
});
