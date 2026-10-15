import {
  createProductSchema,
  type CreateProduct,
  type ProductImportResult,
  STOCK_STATUSES,
  type UpdateProduct,
} from "@brainstack/shared";
import { API_BASE, apiFetch } from "@/lib/api";

/* ─────────────── API shapes (D-2 §2.4) ─────────────── */

export type StockStatus = (typeof STOCK_STATUSES)[number];

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  /** Money is a two-decimal string ("1250.00"); null = ask for the price. */
  price: string | null;
  compareAtPrice: string | null;
  currency: string;
  stockStatus: StockStatus;
  stockQuantity: number | null;
  category: string | null;
  url: string | null;
  imageUrl: string | null;
  attributes: Record<string, string | string[]>;
  isActive: boolean;
}

export interface ProductPage {
  items: Product[];
  nextCursor: string | null;
}

export interface ProductQuery {
  q?: string;
  category?: string;
  isActive?: boolean;
  cursor?: string;
  limit?: number;
}

/** "?q=shoe&isActive=true" for GET /v1/products; blanks are left out. */
export function productQueryString(query: ProductQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.category?.trim()) params.set("category", query.category.trim());
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const text = params.toString();
  return text ? `?${text}` : "";
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const productsApi = {
  list: (query: ProductQuery) =>
    apiFetch<ProductPage>(`/products${productQueryString(query)}`),
  create: (body: CreateProduct) =>
    apiFetch<Product>("/products", json("POST", body)),
  update: (id: string, body: UpdateProduct) =>
    apiFetch<Product>(`/products/${id}`, json("PATCH", body)),
  remove: (id: string) => apiFetch<void>(`/products/${id}`, json("DELETE")),
  importCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<ProductImportResult>("/products/import", {
      method: "POST",
      body: form,
    });
  },
  /** A plain link: the browser sends the session cookie with it. */
  templateUrl: `${API_BASE}/products/import/template.csv`,
};

/* ─────────────── Display ─────────────── */

/** "৳1,250.00" or "$49.90"; "—" when there's no price. */
export function formatPrice(price: string | null, currency: string): string {
  if (price === null) return "—";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(
      Number(price),
    );
  } catch {
    return `${price} ${currency}`;
  }
}

export const STOCK_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  OUT_OF_STOCK: "Out of stock",
  PREORDER: "Pre-order",
  UNKNOWN: "Unknown",
};

/** "In stock (12)" when a quantity is known. */
export function stockLabel(status: StockStatus, quantity: number | null) {
  const label = STOCK_LABELS[status];
  return quantity !== null && status === "IN_STOCK" ? `${label} (${quantity})` : label;
}

/* ─────────────── Add/edit form ─────────────── */

export interface AttributeRow {
  key: string;
  /** Several values separated by commas become a list ("red, blue"). */
  value: string;
}

/** The sheet's form: plain strings, as inputs hold them. */
export interface ProductForm {
  name: string;
  sku: string;
  description: string;
  price: string;
  compareAtPrice: string;
  currency: string;
  stockStatus: StockStatus;
  stockQuantity: string;
  category: string;
  url: string;
  imageUrl: string;
  isActive: boolean;
  attributes: AttributeRow[];
}

export function emptyProductForm(): ProductForm {
  return {
    name: "",
    sku: "",
    description: "",
    price: "",
    compareAtPrice: "",
    currency: "",
    stockStatus: "UNKNOWN",
    stockQuantity: "",
    category: "",
    url: "",
    imageUrl: "",
    isActive: true,
    attributes: [],
  };
}

export function formFromProduct(p: Product): ProductForm {
  return {
    name: p.name,
    sku: p.sku ?? "",
    description: p.description ?? "",
    price: p.price ?? "",
    compareAtPrice: p.compareAtPrice ?? "",
    currency: p.currency,
    stockStatus: p.stockStatus,
    stockQuantity: p.stockQuantity === null ? "" : String(p.stockQuantity),
    category: p.category ?? "",
    url: p.url ?? "",
    imageUrl: p.imageUrl ?? "",
    isActive: p.isActive,
    attributes: Object.entries(p.attributes).map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(", ") : value,
    })),
  };
}

export type FormCheck =
  | { ok: true; body: CreateProduct }
  | { ok: false; errors: Record<string, string> };

/**
 * Turns the form into an API body and checks it with the shared schema,
 * so mistakes show per field before saving. An empty currency is left
 * out: new products get the chatbot's currency, edits keep theirs.
 */
export function productBodyFromForm(form: ProductForm): FormCheck {
  const errors: Record<string, string> = {};
  const attributes: Record<string, string | string[]> = {};
  for (const row of form.attributes) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) continue;
    if (!key || !value) {
      errors.attributes = "Each attribute needs a name and a value";
      continue;
    }
    if (key in attributes) {
      errors.attributes = `"${key}" is listed twice`;
      continue;
    }
    const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
    attributes[key] = parts.length > 1 ? parts : value;
  }

  const quantity = form.stockQuantity.trim();
  const candidate = {
    name: form.name,
    sku: form.sku,
    description: form.description,
    price: form.price,
    compareAtPrice: form.compareAtPrice,
    ...(form.currency.trim() && { currency: form.currency }),
    stockStatus: form.stockStatus,
    // Not a whole number stays a string, so the schema reports it.
    stockQuantity: quantity === "" ? null : /^\d+$/.test(quantity) ? Number(quantity) : quantity,
    category: form.category,
    url: form.url,
    imageUrl: form.imageUrl,
    attributes,
    isActive: form.isActive,
  };
  const result = createProductSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !result.success) {
    return { ok: false, errors };
  }
  return { ok: true, body: result.data };
}

/* ─────────────── CSV import result ─────────────── */

/** A CSV of the failed rows ("row,error"), for the company to fix. */
export function failedRowsCsv(errors: ProductImportResult["errors"]): string {
  const cell = (text: string) => `"${text.replace(/"/g, '""')}"`;
  return [
    "row,error",
    ...errors.map((e) => `${e.row},${cell(e.message)}`),
  ].join("\r\n");
}
