"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  adminApi,
  adminConsoleApi,
  PLAN_LABELS,
  type AdminWorkspace,
  type AdminWorkspaceQuery,
  type WorkspacePlan,
  type WorkspaceStatus,
} from "@/lib/admin";
import { formatDateTime } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toast";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const ALL = "ALL";

type Pending =
  | { kind: "status"; workspace: AdminWorkspace; to: WorkspaceStatus }
  | { kind: "plan"; workspace: AdminWorkspace; to: WorkspacePlan };

/**
 * Super-admin console (D-3 §1.3, M7-0): every workspace with its owner,
 * plan, chatbots and this month's message count (a counter, never the
 * messages), plus manual plan changes and suspend/unsuspend. Every change
 * asks for confirmation and is written to the audit log by the API.
 */
export default function AdminWorkspacesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<WorkspaceStatus | typeof ALL>(ALL);
  const [query, setQuery] = useState<AdminWorkspaceQuery>({});
  const [items, setItems] = useState<AdminWorkspace[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AdminWorkspace | null>(null);
  const [slugInput, setSlugInput] = useState("");

  // Typing settles before searching.
  useEffect(() => {
    const timer = setTimeout(
      () => setQuery({ q: search, status: status === ALL ? undefined : status }),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search, status]);

  // A newer search can finish before an older one; only the latest counts.
  useEffect(() => {
    let cancelled = false;
    adminApi.listWorkspaces({ ...query, limit: PAGE_SIZE }).then(
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
  }, [query]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await adminApi.listWorkspaces({
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

  function ask(next: Pending) {
    setReason("");
    setPending(next);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const body =
        pending.kind === "status"
          ? { status: pending.to, reason: reason.trim() || undefined }
          : { plan: pending.to, reason: reason.trim() || undefined };
      const updated = await adminApi.updateWorkspace(pending.workspace.id, body);
      setItems((list) =>
        (list ?? [])
          // Keep the filter honest: a suspended row leaves an "Active" list.
          .map((w) => (w.id === updated.id ? updated : w))
          .filter((w) => !query.status || w.status === query.status),
      );
      toastSuccess(`Updated ${updated.name}.`);
      setPending(null);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await adminConsoleApi.deleteWorkspace(
        deleting.id,
        slugInput.trim(),
        reason.trim() || undefined,
      );
      setItems((list) => (list ?? []).filter((w) => w.id !== deleting.id));
      toastSuccess(`Deleted ${deleting.name}.`);
      setDeleting(null);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = Boolean(query.q?.trim() || query.status);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Workspaces</h2>
        <p className="text-sm text-muted-foreground">
          Every company on the platform. Message counts are totals only; their
          conversations are not visible here.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search company or owner email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus((v ?? ALL) as WorkspaceStatus | typeof ALL)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items === null ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {filtered ? "No workspace matches." : "No workspaces yet."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Chatbots</TableHead>
                <TableHead className="text-right">Messages (month)</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>
                    {w.owner ? (
                      <span title={w.owner.name}>{w.owner.email}</span>
                    ) : (
                      <span className="text-muted-foreground">No owner</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={w.plan}
                      onValueChange={(v) =>
                        v && v !== w.plan && ask({ kind: "plan", workspace: w, to: v as WorkspacePlan })
                      }
                    >
                      <SelectTrigger size="sm" className="w-28" aria-label={`Plan for ${w.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PLAN_LABELS) as WorkspacePlan[]).map((p) => (
                          <SelectItem key={p} value={p}>
                            {PLAN_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={w.status === "SUSPENDED" ? "destructive" : "secondary"}>
                      {w.status === "SUSPENDED" ? "Suspended" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{w.chatbotCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.messagesThisMonth}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(w.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                    <Link
                      href={`/admin/workspaces/${w.id}`}
                      className="inline-flex h-7 items-center rounded-md border px-2.5 text-sm hover:bg-muted"
                    >
                      View setup
                    </Link>
                    {w.status === "SUSPENDED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => ask({ kind: "status", workspace: w, to: "ACTIVE" })}
                      >
                        Unsuspend
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => ask({ kind: "status", workspace: w, to: "SUSPENDED" })}
                      >
                        Suspend
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => {
                        setReason("");
                        setSlugInput("");
                        setDeleting(w);
                      }}
                    >
                      Delete
                    </Button>
                    </div>
                  </TableCell>
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

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>{confirmTitle(pending)}</DialogTitle>
                <DialogDescription>{confirmText(pending)}</DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-sm">
                Reason (optional, saved in the audit log)
                <Input
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant={
                    pending.kind === "status" && pending.to === "SUSPENDED"
                      ? "destructive"
                      : "default"
                  }
                  disabled={busy}
                  onClick={confirm}
                >
                  {busy ? "Saving…" : confirmButton(pending)}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <DialogContent>
          {deleting && (
            <>
              <DialogHeader>
                <DialogTitle>Delete {deleting.name}?</DialogTitle>
                <DialogDescription>
                  This permanently removes the workspace, its chatbot, FAQs,
                  documents, conversations, leads and usage. People keep their
                  accounts. It cannot be undone. Type{" "}
                  <span className="font-mono font-semibold">{deleting.slug}</span> to
                  confirm.
                </DialogDescription>
              </DialogHeader>
              <Input
                aria-label="Workspace slug"
                autoComplete="off"
                placeholder={deleting.slug}
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
              />
              <label className="grid gap-1.5 text-sm">
                Reason (optional, saved in the audit log)
                <Input
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || slugInput.trim() !== deleting.slug}
                  onClick={confirmDelete}
                >
                  {busy ? "Deleting…" : "Delete workspace"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function confirmTitle(p: Pending): string {
  if (p.kind === "plan") return `Change plan of ${p.workspace.name}?`;
  return p.to === "SUSPENDED"
    ? `Suspend ${p.workspace.name}?`
    : `Unsuspend ${p.workspace.name}?`;
}

function confirmText(p: Pending): string {
  if (p.kind === "plan") {
    return `The plan changes from ${PLAN_LABELS[p.workspace.plan]} to ${PLAN_LABELS[p.to]}.`;
  }
  return p.to === "SUSPENDED"
    ? "Its members are locked out of the dashboard and its chat widget stops answering visitors straight away."
    : "Its members can use the dashboard again and the chat widget answers visitors again.";
}

function confirmButton(p: Pending): string {
  if (p.kind === "plan") return "Change plan";
  return p.to === "SUSPENDED" ? "Suspend" : "Unsuspend";
}
