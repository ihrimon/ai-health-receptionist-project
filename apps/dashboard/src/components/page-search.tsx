"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ADMIN_PAGES, flatNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The header's search box: looks like an input, opens a Ctrl+K palette that
 * jumps to any dashboard page. It searches page names only, never data.
 */
export function PageSearch({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const pages = useMemo(() => (admin ? ADMIN_PAGES : flatNav()), [admin]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) =>
      `${p.title} ${p.section}`.toLowerCase().includes(q),
    );
  }, [pages, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  }

  function go(href: string) {
    change(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-card px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent/50"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search pages…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">
          Ctrl K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogTitle className="sr-only">Search pages</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              aria-label="Search pages"
              placeholder="Search pages…"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && results[active]) {
                  go(results[active].href);
                }
              }}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul ref={listRef} className="max-h-72 overflow-y-auto p-2">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No pages match &ldquo;{query}&rdquo;.
              </li>
            )}
            {results.map((p, i) => (
              <li key={`${p.section}-${p.href}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(p.href)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                >
                  <p.icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.section}
                  </span>
                  {i === active && <CornerDownLeft className="size-3.5" />}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
