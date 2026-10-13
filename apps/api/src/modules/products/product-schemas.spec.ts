import {
  createProductSchema,
  productListQuerySchema,
  updateProductSchema,
} from '@brainstack/shared';

// The shared products schemas, tested where they're enforced.

const paths = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) => (result.success ? [] : result.error!.issues.map((i) => i.path.join('.')));

describe('product schemas', () => {
  it('fills defaults and normalizes a new product', () => {
    expect(
      createProductSchema.parse({
        name: ' Running shoe ',
        sku: '  ',
        price: '49.5',
        currency: 'bdt',
      }),
    ).toEqual({
      name: 'Running shoe',
      sku: null,
      price: '49.50',
      currency: 'BDT',
      stockStatus: 'UNKNOWN',
      attributes: {},
      isActive: true,
    });
  });

  it('takes money as a string with at most two decimals', () => {
    const price = (value: unknown) =>
      paths(createProductSchema.safeParse({ name: 'x', price: value }));
    expect(price('1250')).toEqual([]);
    expect(price('0.99')).toEqual([]);
    expect(price(12)).toEqual(['price']);
    expect(price('12.345')).toEqual(['price']);
    expect(price('-5')).toEqual(['price']);
    expect(price('12345678901')).toEqual(['price']);
  });

  it('needs the compare-at price above the price', () => {
    const prices = (price: string | null, compareAtPrice: string) =>
      paths(
        createProductSchema.safeParse({ name: 'x', price, compareAtPrice }),
      );
    expect(prices('40', '50')).toEqual([]);
    expect(prices('50', '50')).toEqual(['compareAtPrice']);
    expect(prices(null, '50')).toEqual(['compareAtPrice']);
  });

  it('checks the other fields', () => {
    const product = (extra: object) =>
      paths(createProductSchema.safeParse({ name: 'x', ...extra }));
    expect(product({ currency: 'XYZ' })).toEqual(['currency']);
    expect(product({ stockStatus: 'SOLD' })).toEqual(['stockStatus']);
    expect(product({ stockQuantity: -1 })).toEqual(['stockQuantity']);
    expect(product({ url: 'ftp://shop.test/a' })).toEqual(['url']);
    expect(product({ imageUrl: 'https://cdn.shop.test/a.png' })).toEqual([]);
    expect(
      product({ attributes: { color: ['red', 'blue'], size: 'M' } }),
    ).toEqual([]);
    expect(product({ attributes: { color: 3 } })).toEqual(['attributes.color']);
    expect(product({ externalId: 'shopify-1' })).toEqual(['']);
  });

  it('rejects an empty update and allows clearing the price', () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false);
    expect(updateProductSchema.parse({ price: null })).toEqual({ price: null });
  });

  it('parses the list query', () => {
    expect(
      productListQuerySchema.parse({
        q: ' shoe ',
        isActive: 'false',
        limit: '5',
      }),
    ).toEqual({ q: 'shoe', isActive: false, limit: 5 });
    expect(productListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(productListQuerySchema.safeParse({ limit: '500' }).success).toBe(
      false,
    );
    expect(productListQuerySchema.safeParse({ sort: 'price' }).success).toBe(
      false,
    );
  });
});
