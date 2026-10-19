"use client";

import type { LeadSummary } from "@brainstack/shared";
import { Download, Mail, MessagesSquare, Phone, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDelete, EmptyState } from "@/components/knowledge/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/api";
import { originLabel, timeAgo } from "@/lib/conversations";
import { type LeadQuery, leadsApi, leadTitle } from "@/lib/leads";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

/**
 * Leads (D-3 §1.2, M5-5, FR-8.2): visitors who left their contact details
 * in a chat, newest first, with search, dates and a CSV export. A lead
 * links to its conversation while that still exists. Owners and admins
 * can export and delete; viewers only read.
 */
export default function LeadsPage() {
  const { me } = useSession();
  const canManage = me.role === "OWNER" || me.role === "ADMIN";
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState<LeadQuery>({});
  const [items, setItems] = useState<LeadSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState<LeadSummary | null>(null);

  // Typing settles before searching.
  useEffect(() => {
    const timer = setTimeout(() => setQuery({ q: search, from, to }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, from, to]);

  // A newer search can finish before an older one; only the latest counts.
  useEffect(() => {
    let cancelled = false;
    leadsApi.list({ ...query, limit: PAGE_SIZE }).then(
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
      const page = await leadsApi.list({ ...query, cursor: nextCursor, limit: PAGE_SIZE });
      setItems((list) => [...(list ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await leadsApi.exportCsv(query);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const filtered = Boolean(query.q?.trim() || query.from || query.to);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Leads</h2>
          <p className="text-sm text-muted-foreground">
            Visitors who left their contact details while chatting with your bot.
          </p>
        </div>
        {canManage && (
          <Button
            variant="outline"
            disabled={exporting || !items?.length}
            onClick={exportCsv}
          >
            <Download /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name, email or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            className="w-40"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            className="w-40"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {items === null ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState title="No leads match" example="Try another search or clear the dates." />
        ) : (
          <EmptyState
            title="No leads yet"
            example="Leads appear here when visitors share their name, email or phone in a chat."
          />
        )
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((lead) => (
            <li key={lead.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{leadTitle(lead)}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {lead.email && (
                      <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:underline">
                        <Mail className="size-3.5" /> {lead.email}
                      </a>
                    )}
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:underline">
                        <Phone className="size-3.5" /> {lead.phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(lead.createdAt)}
                  >
                    {timeAgo(lead.createdAt)}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${leadTitle(lead)}`}
                      onClick={() => setDeleting(lead)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>

              {lead.answers.length > 0 && (
                <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  {lead.answers.map((a) => (
                    <div key={a.questionId} className="contents">
                      <dt className="text-muted-foreground">{a.question ?? "Removed question"}</dt>
                      <dd className="break-words">{a.answer}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {lead.conversationId ? (
                  <Link
                    href={`/app/conversations/${lead.conversationId}`}
                    className="flex items-center gap-1 text-foreground hover:underline"
                  >
                    <MessagesSquare className="size-3" /> View conversation
                  </Link>
                ) : (
                  <span>Conversation deleted</span>
                )}
                {lead.sourceUrl && <span className="truncate">from {originLabel(lead.sourceUrl)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <Button variant="outline" className="mx-auto" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}

      <ConfirmDelete
        what={deleting ? leadTitle(deleting) : null}
        description="The lead's contact details are deleted for good. Its conversation stays."
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await leadsApi.remove(deleting.id);
          setItems((list) => list?.filter((l) => l.id !== deleting.id) ?? null);
          toastSuccess("Lead deleted.");
        }}
      />
    </div>
  );
}
