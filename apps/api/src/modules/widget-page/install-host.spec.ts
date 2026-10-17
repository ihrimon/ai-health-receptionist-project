import { embeddingHost, hostAllowed } from './install-host';

describe('hostAllowed (M4-14)', () => {
  const domains = ['shop.example.com', '*.brand.example', 'localhost:3000'];

  it('matches what frame-ancestors allows', () => {
    expect(hostAllowed('shop.example.com', domains, true)).toBe(true);
    expect(hostAllowed('eu.brand.example', domains, true)).toBe(true);
    expect(hostAllowed('localhost:3000', domains, true)).toBe(true);
  });

  it('refuses everything else', () => {
    for (const host of [
      'example.com',
      'other.example.com',
      'brand.example',
      'evilbrand.example',
      'shop.example.com:8443',
      'localhost:4000',
    ]) {
      expect(hostAllowed(host, domains, true)).toBe(false);
    }
  });

  it('allows localhost only outside production, any port for a bare entry', () => {
    expect(hostAllowed('localhost:5173', ['localhost'], true)).toBe(true);
    expect(hostAllowed('localhost:3000', domains, false)).toBe(false);
  });
});

describe('embeddingHost (M4-14)', () => {
  const domains = ['shop.example.com', 'localhost'];
  const host = (req: Parameters<typeof embeddingHost>[0], local = true) =>
    embeddingHost(req, domains, local);

  it('takes the site from the Referer of the framed page', () => {
    expect(
      host({ referer: 'https://shop.example.com/', fetchDest: 'iframe' }),
    ).toBe('shop.example.com');
    expect(host({ referer: 'https://shop.example.com/cart?x=1' })).toBe(
      'shop.example.com',
    );
  });

  it("falls back to the loader's ?host= when there is no usable Referer", () => {
    expect(host({ hostParam: 'https://shop.example.com' })).toBe(
      'shop.example.com',
    );
    expect(
      host({
        referer: 'https://unlisted.example.net/',
        hostParam: 'https://shop.example.com',
      }),
    ).toBe('shop.example.com');
  });

  it('allows http only for localhost', () => {
    expect(host({ referer: 'http://localhost:3000/' })).toBe('localhost:3000');
    expect(host({ referer: 'http://shop.example.com/' })).toBeNull();
    expect(host({ referer: 'http://localhost:3000/' }, false)).toBeNull();
  });

  it('ignores a load that is not in an iframe, and junk values', () => {
    expect(
      host({ referer: 'https://shop.example.com/', fetchDest: 'document' }),
    ).toBeNull();
    expect(host({ referer: 'not a url', hostParam: ['x', 'y'] })).toBeNull();
    expect(host({ hostParam: 'javascript:alert(1)' })).toBeNull();
    expect(host({})).toBeNull();
  });
});
