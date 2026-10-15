import { z } from 'zod';
import { isoCurrency, optional, text } from './text';

/**
 * Request bodies and list query for the products API (D-2 §2.4). Money is
 * a string ("1250.00") everywhere, so no float rounding creeps in (D-2 §1).
 */

export const STOCK_STATUSES = [
  'IN_STOCK',
  'OUT_OF_STOCK',
  'PREORDER',
  'UNKNOWN',
] as const;

// Fits the database's Decimal(12,2): up to 10 digits before the point.
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

/** A price as a string, normalized to two decimals ("12" → "12.00"). */
const money = z
  .string()
  .trim()
  .regex(MONEY, { message: 'Must be an amount like 1250 or 1250.50' })
  .transform((value) => Number(value).toFixed(2));

const webUrl = z.url({ protocol: /^https?$/ }).max(2000);

/** e.g. { "color": ["red", "blue"], "size": "M" }; kept small for prompts. */
const attributes = z
  .record(
    text(1, 50),
    z.union([text(1, 100), z.array(text(1, 100)).max(20)]),
  )
  .refine((value) => Object.keys(value).length <= 20, {
    message: 'At most 20 attributes',
  });

const productFields = {
  sku: optional(text(1, 100)),
  name: text(1, 255),
  description: optional(text(1, 5000, true)),
  /** null = "contact us for the price". */
  price: optional(money),
  /** The price before a discount; must be higher than price. */
  compareAtPrice: optional(money),
  /** Defaults to the chatbot config's business.currency. */
  currency: isoCurrency,
  stockStatus: z.enum(STOCK_STATUSES),
  stockQuantity: z.number().int().min(0).max(1_000_000_000).nullable(),
  category: optional(text(1, 100)),
  url: optional(webUrl),
  imageUrl: optional(webUrl),
  attributes,
  isActive: z.boolean(),
};

interface Prices {
  price?: string | null;
  compareAtPrice?: string | null;
}

/** compareAtPrice needs a price below it (checked when both are sent). */
function checkPrices(value: Prices, ctx: z.RefinementCtx): void {
  const { price, compareAtPrice } = value;
  if (compareAtPrice == null || price === undefined) return;
  if (price === null || Number(compareAtPrice) <= Number(price)) {
    ctx.addIssue({
      code: 'custom',
      path: ['compareAtPrice'],
      message: 'Must be higher than the price',
    });
  }
}

export const createProductSchema = z
  .strictObject({
    ...productFields,
    sku: productFields.sku.optional(),
    description: productFields.description.optional(),
    price: productFields.price.optional(),
    compareAtPrice: productFields.compareAtPrice.optional(),
    currency: productFields.currency.optional(),
    stockStatus: productFields.stockStatus.default('UNKNOWN'),
    stockQuantity: productFields.stockQuantity.optional(),
    category: productFields.category.optional(),
    url: productFields.url.optional(),
    imageUrl: productFields.imageUrl.optional(),
    attributes: productFields.attributes.default({}),
    isActive: productFields.isActive.default(true),
  })
  .superRefine(checkPrices);

export const updateProductSchema = z
  .strictObject(productFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  })
  .superRefine(checkPrices);

/** GET /v1/products query: search, filters and cursor paging. */
export const productListQuerySchema = z.strictObject({
  /** Matches name or SKU, ignoring case. */
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** `nextCursor` from the previous page; opaque to the client. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Columns of the product CSV (D-2 §2.4), in template order. Only `name` is
 * required; a row whose `sku` already exists updates that product.
 */
export const PRODUCT_CSV_COLUMNS = [
  'sku',
  'name',
  'description',
  'price',
  'compare_at_price',
  'currency',
  'stock_status',
  'stock_quantity',
  'category',
  'url',
  'image_url',
] as const;

export type ProductCsvColumn = (typeof PRODUCT_CSV_COLUMNS)[number];

/** A CSV import's result: one entry per failed row (header = row 1). */
export interface ProductImportResult {
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export type CreateProduct = z.output<typeof createProductSchema>;
export type UpdateProduct = z.output<typeof updateProductSchema>;
export type ProductListQuery = z.output<typeof productListQuerySchema>;
