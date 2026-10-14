"use client";

import { KNOWLEDGE_LIMITS } from "@brainstack/shared";
import { ImageOff, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ImportDialog } from "@/components/products/import-dialog";
import { ProductSheet } from "@/components/products/product-sheet";
import { ConfirmDelete, EmptyState } from "@/components/knowledge/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useChatbot } from "@/lib/chatbot";
import {
  formatPrice,
  type Product,
  type ProductQuery,
  productsApi,
  stockLabel,
} from "@/lib/products";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

const ACTIVE_ITEMS = [
  { value: "all", label: "All products" },
  { value: "true", label: "Active" },
  { value: "false", label: "Hidden" },
];

/**
 * Products (D-3 §3.4, M2-19): search, filter, add/edit in a sheet, CSV
 * import. The API pages with an opaque cursor, so the list grows with
 * "Load more" instead of numbered pages.
 */
export default function ProductsPage() {
  const { me } = useSession();
  const { refresh: refreshChatbot } = useChatbot();
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [active, setActive] = useState("all");
  const [query, setQuery] = useState<ProductQuery>({});
  const [items, setItems] = useState<Product[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);

  // Typing settles before searching.
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setQuery({
          q: search,
          category,
          isActive: active === "all" ? undefined : active === "true",
        }),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search, category, active]);

  const loadFirst = useCallback(async () => {
    const page = await productsApi.list({ ...query, limit: PAGE_SIZE });
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }, [query]);

  // A newer search can finish before an older one; only the latest counts.
  useEffect(() => {
    let cancelled = false;
    productsApi.list({ ...query, limit: PAGE_SIZE }).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      },
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [query, me.activeWorkspace?.id]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await productsApi.list({
        ...query,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setItems((list) => [...(list ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /** After a change: reload, and let the banner re-check publishing. */
  const changed = useCallback(async () => {
    await loadFirst();
    await refreshChatbot().catch(() => {});
  }, [loadFirst, refreshChatbot]);

  const filtered = Boolean(query.q || query.category || query.isActive !== undefined);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Products</h2>
          <p className="text-sm text-muted-foreground">
            What the bot can recommend, with prices and stock. Up to{" "}
            {KNOWLEDGE_LIMITS.products} products.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload /> Import CSV
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Add product
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Input
          className="w-full sm:w-44"
          placeholder="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Select items={ACTIVE_ITEMS} value={active} onValueChange={(v) => setActive(String(v))}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items === null ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState title="No products match" example="Try another search or clear the filters." />
        ) : (
          <EmptyState
            title="No products yet"
            example="Add them one by one, or import a CSV file exported from your shop or a spreadsheet."
          />
        )
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">SKU</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="hidden md:table-cell">Stock</TableHead>
                <TableHead className="w-20">Status</TableHead>
                {canEdit && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Thumbnail src={p.imageUrl} />
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    <span className="font-medium">{p.name}</span>
                    {p.category && (
                      <span className="block text-xs text-muted-foreground">{p.category}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {p.sku ?? "—"}
                  </TableCell>
                  <TableCell>{formatPrice(p.price, p.currency)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {stockLabel(p.stockStatus, p.stockQuantity)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? "outline" : "secondary"}>
                      {p.isActive ? "Active" : "Hidden"}
                    </Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(p)}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => setDeleting(p)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor && (
        <Button variant="outline" className="mx-auto" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}

      {editing && (
        <ProductSheet
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
      {importing && (
        <ImportDialog onClose={() => setImporting(false)} onImported={changed} />
      )}
      <ConfirmDelete
        what={deleting ? `"${deleting.name}"` : null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await productsApi.remove(deleting!.id);
          await changed();
          toastSuccess("Product deleted.");
        }}
      />
    </div>
  );
}

/**
 * The product's own image link (the shop's site), small. Not next/image:
 * that needs every shop's domain configured. A broken link shows an icon.
 */
function Thumbnail({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex size-10 items-center justify-center rounded bg-muted">
        <ImageOff className="size-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="size-10 rounded object-cover"
      onError={() => setBroken(true)}
    />
  );
}
