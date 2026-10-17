"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastError } from "@/lib/toast";

/** Props every knowledge tab gets from the page. */
export interface TabBase {
  canEdit: boolean;
  /** Reloads the lists (and the publish banner) after a change. */
  onChanged: () => Promise<void>;
}

/** A tab's title row: what it is, how many fit, and the add button. */
export function TabHeader({
  title,
  description,
  limit,
  action,
}: {
  title: string;
  description: string;
  limit?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-xl">
        <h3 className="font-medium">
          {title}
          {limit && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {limit}
            </span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** The empty state: what this is for, with an example (D-3 §4). */
export function EmptyState({
  title,
  example,
}: {
  title: string;
  example: string;
}) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{example}</p>
    </div>
  );
}

/** "Delete X?" with a destructive confirm button. */
export function ConfirmDelete({
  what,
  onConfirm,
  onClose,
  description = "The chatbot stops using it right away. This can't be undone.",
}: {
  /** e.g. "this FAQ"; null closes the dialog. */
  what: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  description?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={what !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {what}?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                toastError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
