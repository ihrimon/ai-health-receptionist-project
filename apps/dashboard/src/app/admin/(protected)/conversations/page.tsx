"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch, formatDateTime, type Conversation } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toast";

function preview(conversation: Conversation): string {
  const turns = conversation.transcript ?? [];
  const firstUser = turns.find((t) => t.role === "user");
  return firstUser?.text ?? conversation.summary ?? "(no transcript)";
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  function load() {
    apiFetch<Conversation[]>("/conversations")
      .then(setConversations)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await apiFetch(`/conversations/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toastSuccess("Conversation deleted.");
      setDeleteTarget(null);
      load();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Conversations</CardTitle>
          <CardDescription>
            {conversations
              ? `${conversations.length} total`
              : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {conversations && conversations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No conversations yet — try the{" "}
              <Link href="/chat" className="underline">
                chat page
              </Link>
              .
            </p>
          )}

          <div className="grid gap-2">
            {conversations?.map((c) => (
              <div
                key={c.id}
                className="relative rounded-lg border p-3 transition-colors hover:border-foreground/30"
              >
                <Link
                  href={`/admin/conversations/${c.id}`}
                  className="block pr-9"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {preview(c)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{c.transcript?.length ?? 0} messages</span>
                    {c.rating && (
                      <Badge
                        variant="outline"
                        className="gap-0.5 border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      >
                        <Star className="size-3 fill-current" />
                        {c.rating}/5
                      </Badge>
                    )}
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete conversation"
                  disabled={busyId === c.id}
                  onClick={() => setDeleteTarget(c)}
                  className="absolute right-2 top-2 text-destructive hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete this conversation transcript?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busyId === deleteTarget?.id}
              onClick={confirmDelete}
            >
              {busyId === deleteTarget?.id ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
