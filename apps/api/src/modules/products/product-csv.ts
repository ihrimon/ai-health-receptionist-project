import {
  KNOWLEDGE_LIMITS,
  PRODUCT_CSV_COLUMNS,
  type ProductCsvColumn,
} from '@brainstack/shared';
import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

/** The upload limit for product CSVs; 200 full rows fit easily. */
export const PRODUCT_CSV_MAX_BYTES = 1024 * 1024;

export interface ProductCsvRow {
  /** Spreadsheet row number: the header is row 1, the first product row 2. */
  row: number;
  values: Partial<Record<ProductCsvColumn, string>>;
}

const KNOWN = new Set<string>(PRODUCT_CSV_COLUMNS);

function fileError(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'VALIDATION_FAILED',
    message,
  });
}

/**
 * Reads a product CSV (D-2 §2.4). Problems with the file as a whole (bad
 * format, unknown or missing columns, too many rows) are a 400; problems
 * in single rows are left to the import, which reports them per row.
 */
export function parseProductCsv(file: Buffer): ProductCsvRow[] {
  let records: string[][];
  try {
    records = parse(file, {
      // Excel saves "CSV UTF-8" with a byte-order mark.
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    throw fileError(
      `The file isn't a valid CSV: ${err instanceof Error ? err.message : 'unreadable'}`,
    );
  }

  const [header, ...rows] = records;
  if (!header) throw fileError('The file is empty');
  const columns = header.map((name) => name.toLowerCase());

  const unknown = columns.filter((c) => !KNOWN.has(c));
  if (unknown.length) {
    throw fileError(
      `Unknown columns: ${unknown.join(', ')}. Allowed: ${PRODUCT_CSV_COLUMNS.join(', ')}`,
    );
  }
  if (new Set(columns).size !== columns.length) {
    throw fileError('A column appears more than once');
  }
  if (!columns.includes('name')) {
    throw fileError('The name column is required');
  }
  if (rows.length === 0) throw fileError('The file has no product rows');
  if (rows.length > KNOWLEDGE_LIMITS.products) {
    throw fileError(
      `At most ${KNOWLEDGE_LIMITS.products} product rows per file`,
    );
  }

  return rows.map((cells, i) => ({
    row: i + 2,
    values: Object.fromEntries(
      columns.map((column, c) => [column, cells[c] ?? '']),
    ),
  }));
}

/**
 * Turns a CSV row into a create-product body. An empty cell means "not
 * set": null for optional fields, so re-importing a row clears a value
 * that was removed in the spreadsheet. An empty currency is left out, so
 * new products get the chatbot's currency and updates keep theirs.
 */
export function csvRowToProduct(values: ProductCsvRow['values']) {
  const cell = (column: ProductCsvColumn) => values[column] ?? '';
  const orNull = (column: ProductCsvColumn) => cell(column) || null;
  const quantity = cell('stock_quantity');
  return {
    sku: orNull('sku'),
    name: cell('name'),
    description: orNull('description'),
    price: orNull('price'),
    compareAtPrice: orNull('compare_at_price'),
    currency: cell('currency') || undefined,
    stockStatus: cell('stock_status').toUpperCase() || 'UNKNOWN',
    // Not a number stays a string, so the schema reports it.
    stockQuantity:
      quantity === ''
        ? null
        : /^\d+$/.test(quantity)
          ? Number(quantity)
          : quantity,
    category: orNull('category'),
    url: orNull('url'),
    imageUrl: orNull('image_url'),
  };
}

/** The downloadable template: the header and one example row. */
export function productCsvTemplate(): string {
  const example = [
    'SHOE-001',
    'Trail running shoe',
    '"Lightweight, waterproof trail shoe"',
    '89.00',
    '110.00',
    'USD',
    'IN_STOCK',
    '25',
    'Footwear',
    'https://shop.example.com/products/trail-shoe',
    'https://shop.example.com/images/trail-shoe.jpg',
  ];
  return `${PRODUCT_CSV_COLUMNS.join(',')}\r\n${example.join(',')}\r\n`;
}
