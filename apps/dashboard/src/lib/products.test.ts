import { describe, expect, it } from "vitest";
import {
  emptyProductForm,
  failedRowsCsv,
  formatPrice,
  formFromProduct,
  type Product,
  productBodyFromForm,
  productQueryString,
  stockLabel,
} from "./products";

const product: Product = {
  id: "p-1",
  sku: "SH-1",
  name: "Trail shoe",
  description: null,
  price: "49.90",
  compareAtPrice: null,
  currency: "USD",
  stockStatus: "IN_STOCK",
  stockQuantity: 12,
  category: "Footwear",
  url: null,
  imageUrl: null,
  attributes: { color: ["red", "blue"], size: "42" },
  isActive: true,
};

describe("productQueryString", () => {
  it("leaves out blanks and keeps the rest", () => {
    expect(productQueryString({})).toBe("");
    expect(
      productQueryString({ q: " shoe ", category: "", isActive: false, limit: 20 }),
    ).toBe("?q=shoe&isActive=false&limit=20");
  });
});

describe("display", () => {
  it("formats money in the product's currency", () => {
    expect(formatPrice("49.90", "USD")).toBe("$49.90");
    expect(formatPrice("1250.00", "BDT")).toContain("1,250.00");
    expect(formatPrice(null, "USD")).toBe("—");
  });

  it("shows a known quantity for products in stock", () => {
    expect(stockLabel("IN_STOCK", 12)).toBe("In stock (12)");
    expect(stockLabel("OUT_OF_STOCK", 0)).toBe("Out of stock");
    expect(stockLabel("UNKNOWN", null)).toBe("Unknown");
  });
});

describe("productBodyFromForm", () => {
  it("round-trips a product through the form", () => {
    const check = productBodyFromForm(formFromProduct(product));
    expect(check).toEqual({
      ok: true,
      body: expect.objectContaining({
        name: "Trail shoe",
        sku: "SH-1",
        price: "49.90",
        currency: "USD",
        stockQuantity: 12,
        attributes: { color: ["red", "blue"], size: "42" },
      }) as unknown,
    });
  });

  it("leaves an empty currency out, so the chatbot's is used", () => {
    const check = productBodyFromForm({ ...emptyProductForm(), name: "Sock" });
    expect(check.ok && "currency" in check.body).toBe(false);
  });

  it("reports field errors from the shared schema", () => {
    const check = productBodyFromForm({
      ...emptyProductForm(),
      name: "",
      price: "cheap",
      stockQuantity: "lots",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(Object.keys(check.errors).sort()).toEqual([
        "name",
        "price",
        "stockQuantity",
      ]);
    }
  });

  it("checks attribute rows: blanks skipped, halves and repeats refused", () => {
    const base = { ...emptyProductForm(), name: "Shoe" };
    expect(
      productBodyFromForm({ ...base, attributes: [{ key: " ", value: "" }] }),
    ).toMatchObject({ ok: true, body: { attributes: {} } });
    expect(
      productBodyFromForm({ ...base, attributes: [{ key: "color", value: "" }] }),
    ).toMatchObject({ ok: false, errors: { attributes: expect.any(String) as unknown } });
    expect(
      productBodyFromForm({
        ...base,
        attributes: [
          { key: "size", value: "42" },
          { key: "size", value: "43" },
        ],
      }),
    ).toMatchObject({ ok: false, errors: { attributes: '"size" is listed twice' } });
  });
});

describe("failedRowsCsv", () => {
  it("quotes messages so commas and quotes survive", () => {
    expect(
      failedRowsCsv([
        { row: 3, message: 'price: Must be an amount like 1250, not "cheap"' },
      ]),
    ).toBe('row,error\r\n3,"price: Must be an amount like 1250, not ""cheap"""');
  });
});
