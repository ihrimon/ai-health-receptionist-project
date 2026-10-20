"use client";

import { Search } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminConsoleApi, type AdminUser } from "@/lib/admin";
import { formatDateTime } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

/**
 * Super-admin console, users (M7-35): every account with its companies, a
 * manual "verify email" for support cases, and granting or removing
 * platform-admin access. Granting asks for confirmation and an optional
 * reason; everything is written to the audit log by the API. Passwords and
 * sessions are never shown.
 */
export default function AdminUsersPage() {
  const { me } = useSession();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AdminUser[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adminChange, setAdminChange] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Typing settles before searching.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A newer search can finish before an older one; only the latest counts.
  useEffect(() => {
    let cancelled = false;
    adminConsoleApi.listUsers({ q: query, limit: PAGE_SIZE }).then(
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
      const page = await adminConsoleApi.listUsers({
        q: query,
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

  function replace(updated: AdminUser) {
    setItems((list) => (list ?? []).map((u) => (u.id === updated.id ? updated : u)));
  }

  async function verify(user: AdminUser) {
    setBusy(true);
    try {
      replace(await adminConsoleApi.verifyEmail(user.id));
      toastSuccess(`Verified ${user.email}.`);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAdminChange() {
    if (!adminChange) return;
    setBusy(true);
    try {
      const updated = await adminConsoleApi.setPlatformAdmin(
        adminChange.id,
        !adminChange.isPlatformAdmin,
        reason.trim() || undefined,
      );
      replace(updated);
      toastSuccess(
        updated.isPlatformAdmin
          ? `${updated.email} is now a platform admin.`
          : `${updated.email} is no longer a platform admin.`,
      );
      setAdminChange(null);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const granting = adminChange ? !adminChange.isPlatformAdmin : false;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 overflow-y-auto p-4 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Users</h2>
        <p className="text-sm text-muted-foreground">
          Every account on the platform. Platform admins can open this console,
          see every company&apos;s setup and delete workspaces, so grant that
          access only to people you trust.
        </p>
      </div>

      <div className="relative w-full sm:w-72">
        <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {items === null ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {query.trim() ? "No user matches." : "No users yet."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => {
                const self = u.id === me.user.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      {u.workspaces.length === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <ul className="grid gap-0.5 text-sm">
                          {u.workspaces.map((w) => (
                            <li key={w.id}>
                              {w.name}{" "}
                              <span className="text-xs text-muted-foreground">
                                ({w.role.toLowerCase()})
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.emailVerifiedAt ? (
                        <Badge variant="secondary">Verified</Badge>
                      ) : (
                        <Badge variant="outline">Not verified</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.isPlatformAdmin ? (
                        <Badge>Platform admin</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Standard</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {!u.emailVerifiedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => verify(u)}
                          >
                            Verify email
                          </Button>
                        )}
                        {self ? (
                          <span className="self-center text-xs text-muted-foreground">
                            You
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant={u.isPlatformAdmin ? "destructive" : "outline"}
                            disabled={busy || (!u.isPlatformAdmin && !u.emailVerifiedAt)}
                            title={
                              !u.isPlatformAdmin && !u.emailVerifiedAt
                                ? "Verify the email first"
                                : undefined
                            }
                            onClick={() => {
                              setReason("");
                              setAdminChange(u);
                            }}
                          >
                            {u.isPlatformAdmin ? "Remove admin" : "Make admin"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor && (
        <Button variant="outline" className="mx-auto" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}

      <Dialog open={adminChange !== null} onOpenChange={(open) => !open && !busy && setAdminChange(null)}>
        <DialogContent>
          {adminChange && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {granting ? "Make" : "Remove"} {adminChange.email}{" "}
                  {granting ? "a platform admin?" : "as platform admin?"}
                </DialogTitle>
                <DialogDescription>
                  {granting
                    ? "They will be able to open the admin console, see every company's chatbot setup, suspend or delete workspaces, change plans and manage other admins."
                    : "They keep their account and companies, but lose access to the admin console straight away."}
                </DialogDescription>
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
                <Button variant="outline" disabled={busy} onClick={() => setAdminChange(null)}>
                  Cancel
                </Button>
                <Button
                  variant={granting ? "default" : "destructive"}
                  disabled={busy}
                  onClick={confirmAdminChange}
                >
                  {busy ? "Saving…" : granting ? "Make admin" : "Remove admin"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
