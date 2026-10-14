"use client";

import type { ProductImportResult } from "@brainstack/shared";
import { Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { failedRowsCsv, productsApi } from "@/lib/products";
import { toastError } from "@/lib/toast";

/** Rows shown in the dialog; the download has them all. */
const SHOWN_ERRORS = 20;

/**
 * CSV import (D-3 §3.4, M2-8): template → upload → result. No preview
 * before importing (lead's call): the API checks every row, saves the good
 * ones and lists the bad ones, and a fixed file can be uploaded again
 * (same SKU updates instead of duplicating).
 */
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductImportResult | null>(null);

  async function runImport() {
    if (!file) return;
    setBusy(true);
    try {
      setResult(await productsApi.importCsv(file));
      await onImported();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    if (!result) return;
    const blob = new Blob([failedRowsCsv(result.errors)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "product-import-errors.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            Up to 200 rows. A row whose SKU already exists updates that
            product; other rows add new ones.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-4 text-sm">
            <p>
              1.{" "}
              <a
                className="inline-flex items-center gap-1 text-primary underline"
                href={productsApi.templateUrl}
                download
              >
                <Download className="size-3.5" /> Download the template
              </a>{" "}
              and fill it in (Excel or Google Sheets, saved as CSV).
            </p>
            <div className="grid gap-2">
              <p>2. Choose your file:</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => input.current?.click()}>
                  <FileUp /> Choose CSV
                </Button>
                <span className="truncate text-muted-foreground">
                  {file ? file.name : "No file chosen"}
                </span>
              </div>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <p>
              <strong>{result.created}</strong> added ·{" "}
              <strong>{result.updated}</strong> updated ·{" "}
              <strong className={result.failed ? "text-destructive" : ""}>
                {result.failed}
              </strong>{" "}
              failed
            </p>
            {result.errors.length > 0 && (
              <>
                <ul className="max-h-48 overflow-y-auto rounded-lg border p-2 text-xs">
                  {result.errors.slice(0, SHOWN_ERRORS).map((e) => (
                    <li key={e.row} className="py-0.5">
                      <span className="font-medium">Row {e.row}:</span>{" "}
                      {e.message}
                    </li>
                  ))}
                  {result.errors.length > SHOWN_ERRORS && (
                    <li className="py-0.5 text-muted-foreground">
                      …and {result.errors.length - SHOWN_ERRORS} more
                    </li>
                  )}
                </ul>
                <p className="text-muted-foreground">
                  Fix these rows and import the file again; rows that worked
                  won&apos;t be added twice.
                </p>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              {result.errors.length > 0 && (
                <Button variant="outline" onClick={downloadErrors}>
                  <Download /> Download errors
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!file || busy} onClick={runImport}>
                {busy ? "Importing…" : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
