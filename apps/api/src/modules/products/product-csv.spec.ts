import { createProductSchema, KNOWLEDGE_LIMITS } from '@brainstack/shared';
import { BadRequestException } from '@nestjs/common';
import {
  csvRowToProduct,
  parseProductCsv,
  productCsvTemplate,
} from './product-csv';

const csv = (...lines: string[]) => Buffer.from(lines.join('\r\n'), 'utf8');

describe('parseProductCsv', () => {
  it('reads rows by column name, numbered as in a spreadsheet', () => {
    const rows = parseProductCsv(
      csv('SKU, Name ,price', 'A-1,Shoe,10', '', 'A-2,"Boot, leather",20'),
    );

    expect(rows).toEqual([
      { row: 2, values: { sku: 'A-1', name: 'Shoe', price: '10' } },
      { row: 3, values: { sku: 'A-2', name: 'Boot, leather', price: '20' } },
    ]);
  });

  it('ignores the byte-order mark Excel adds', () => {
    const file = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      csv('name', 'Shoe'),
    ]);
    expect(parseProductCsv(file)[0].values).toEqual({ name: 'Shoe' });
  });

  it.each([
    ['an empty file', csv('')],
    ['a header only', csv('name,price')],
    ['no name column', csv('sku,price', 'A-1,10')],
    ['an unknown column', csv('name,colour', 'Shoe,red')],
    ['a repeated column', csv('name,Name', 'Shoe,Shoe')],
    ['a broken quote', csv('name', '"Shoe')],
    ['rows of different lengths', csv('name,price', 'Shoe,10,extra')],
  ])('is a 400 for %s', (_, file) => {
    expect(() => parseProductCsv(file)).toThrow(BadRequestException);
  });

  it(`allows at most ${KNOWLEDGE_LIMITS.products} product rows`, () => {
    const rows = Array.from(
      { length: KNOWLEDGE_LIMITS.products + 1 },
      (_, i) => `P${i}`,
    );
    expect(() => parseProductCsv(csv('name', ...rows))).toThrow(
      `At most ${KNOWLEDGE_LIMITS.products} product rows per file`,
    );
    expect(parseProductCsv(csv('name', ...rows.slice(1)))).toHaveLength(
      KNOWLEDGE_LIMITS.products,
    );
  });
});

describe('csvRowToProduct', () => {
  it('maps columns to a valid product, empty cells to "not set"', () => {
    const product = csvRowToProduct({
      sku: 'A-1',
      name: 'Shoe',
      description: '',
      price: '10',
      stock_status: 'in_stock',
      stock_quantity: '5',
      currency: '',
    });

    expect(createProductSchema.parse(product)).toMatchObject({
      sku: 'A-1',
      name: 'Shoe',
      description: null,
      price: '10.00',
      stockStatus: 'IN_STOCK',
      stockQuantity: 5,
    });
    expect(product.currency).toBeUndefined();
  });

  it('leaves a non-number quantity for the schema to report', () => {
    const result = createProductSchema.safeParse(
      csvRowToProduct({ name: 'Shoe', stock_quantity: 'lots' }),
    );
    expect(result.success).toBe(false);
  });
});

it('the template parses and its example row is a valid product', () => {
  const [row] = parseProductCsv(Buffer.from(productCsvTemplate()));
  expect(
    createProductSchema.safeParse(csvRowToProduct(row.values)).success,
  ).toBe(true);
});
