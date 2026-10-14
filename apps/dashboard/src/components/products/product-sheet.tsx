"use client";

import { STOCK_STATUSES } from "@brainstack/shared";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import {
  Field,
  TextAreaField,
  TextField,
} from "@/components/chatbot-editor/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  emptyProductForm,
  formFromProduct,
  type Product,
  type ProductForm,
  productBodyFromForm,
  productsApi,
  STOCK_LABELS,
} from "@/lib/products";
import { toastError, toastSuccess } from "@/lib/toast";

const STOCK_ITEMS = STOCK_STATUSES.map((value) => ({
  value,
  label: STOCK_LABELS[value],
}));

/**
 * Add or edit a product (D-3 §3.4) in a sheet on the right, with every
 * D-1 field; attributes are a name/value list.
 */
export function ProductSheet({
  product,
  onClose,
  onSaved,
}: {
  /** null adds a new product. */
  product: Product | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProductForm>(
    product ? formFromProduct(product) : emptyProductForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    const check = productBodyFromForm(form);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (product) await productsApi.update(product.id, check.body);
      else await productsApi.create(check.body);
      await onSaved();
      toastSuccess(product ? "Product updated." : "Product added.");
      onClose();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const setRow = (index: number, row: { key: string; value: string }) =>
    set(
      "attributes",
      form.attributes.map((r, i) => (i === index ? row : r)),
    );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{product ? "Edit product" : "Add product"}</SheetTitle>
          <SheetDescription>
            The bot recommends products and answers about price and stock.
            Saved changes are live right away.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4">
          <TextField label="Name" value={form.name} max={255} error={errors.name} onChange={(v) => set("name", v)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="SKU (optional)" hint="Matches CSV rows to this product." value={form.sku} error={errors.sku} onChange={(v) => set("sku", v)} />
            <TextField label="Category" placeholder="Footwear" value={form.category} error={errors.category} onChange={(v) => set("category", v)} />
          </div>
          <TextAreaField label="Description" value={form.description} max={5000} rows={4} error={errors.description} onChange={(v) => set("description", v)} />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Price" placeholder="1250.00" hint="Empty = ask for price" value={form.price} error={errors.price} onChange={(v) => set("price", v)} />
            <TextField label="Was (optional)" placeholder="1500.00" value={form.compareAtPrice} error={errors.compareAtPrice} onChange={(v) => set("compareAtPrice", v)} />
            <TextField label="Currency" hint="Empty = the bot's" value={form.currency} error={errors.currency} onChange={(v) => set("currency", v.toUpperCase())} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Stock">
              <Select
                items={STOCK_ITEMS}
                value={form.stockStatus}
                onValueChange={(v) => set("stockStatus", v as ProductForm["stockStatus"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <TextField label="Quantity (optional)" value={form.stockQuantity} error={errors.stockQuantity} onChange={(v) => set("stockQuantity", v)} />
          </div>
          <TextField label="Product page link" type="url" placeholder="https://shop.example.com/products/…" value={form.url} error={errors.url} onChange={(v) => set("url", v)} />
          <TextField label="Image link" type="url" placeholder="https://shop.example.com/images/…" value={form.imageUrl} error={errors.imageUrl} onChange={(v) => set("imageUrl", v)} />

          <Field
            label="Attributes"
            hint='e.g. Colour → "red, blue". Commas make a list.'
            error={errors.attributes}
          >
            <div className="grid gap-2">
              {form.attributes.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label="Attribute name" placeholder="Colour" value={row.key} onChange={(e) => setRow(i, { ...row, key: e.target.value })} />
                  <Input aria-label="Attribute value" placeholder="red, blue" value={row.value} onChange={(e) => setRow(i, { ...row, value: e.target.value })} />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove attribute"
                    onClick={() => set("attributes", form.attributes.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => set("attributes", [...form.attributes, { key: "", value: "" }])}
              >
                <Plus /> Add attribute
              </Button>
            </div>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            Show to the bot (active)
          </label>
        </div>

        <SheetFooter className="flex-row justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
