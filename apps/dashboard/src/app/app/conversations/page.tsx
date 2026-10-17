"use client";

import type { ConversationSummary } from "@brainstack/shared";
import { MessageSquare, Search, Star, TriangleAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/knowledge/shared";
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
  type ConversationQuery,
  conversationsApi,
  originLabel,
  type RatingFilter,
  timeAgo,
  visitorLabel,
} from "@/lib/conversations";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

const RATING_ITEMS = [
  { value: "all", label: "Any rating" },
  { value: "5", label: "★★★★★" },
  { value: "4", label: "★★★★" },
  { value: "3", label: "★★★" },
  { value: "2", label: "★★" },
  { value: "1", label: "★" },
  { value: "none", label: "Not rated" },
];

const LEAD_ITEMS = [
  { value: "all", label: "Any chat" },
  { value: "true", label: "Left a lead" },
  { value: "false", label: "No lead" },
];

/**
 * Conversations inbox (D-3 §3.6, M5-2): every visitor chat of this
 * workspace, newest activity first, with search and filters. A row opens
 * the full transcript. Test chats from the dashboard aren't listed.
 */
export default function ConversationsPage() {
  const { me } = useSession();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rating, setRating] = useState("all");
  const [lead, setLead] = useState("all");
  const [query, setQuery] = useState<ConversationQuery>({});
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Typing settles before searching.
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setQuery({
          q: search,
          from,
          to,
          rating: rating === "all" ? undefined : (rating as RatingFilter),
          hasLead: lead === "all" ? undefined : (lead as "true" | "false"),
        }),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search, from, to, rating, lead]);

  // A newer search can finish before an older one; only the latest counts.
  useEffect(() => {
    let cancelled = false;
    conversationsApi.list({ ...query, limit: PAGE_SIZE }).then(
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
      const page = await conversationsApi.list({
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

  const filtered = Boolean(
    query.q?.trim() || query.from || query.to || query.rating || query.hasLead,
  );

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">Conversations</h2>
        <p className="text-sm text-muted-foreground">
          Every chat visitors had with your bot. Search what they asked, and open
          one to see the answers and the knowledge they came from.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search messages"
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
        <Select items={RATING_ITEMS} value={rating} onValueChange={(v) => setRating(String(v))}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RATING_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={LEAD_ITEMS} value={lead} onValueChange={(v) => setLead(String(v))}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_ITEMS.map((item) => (
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
          <EmptyState
            title="No conversations match"
            example="Try another search or clear the filters."
          />
        ) : (
          <EmptyState
            title="No conversations yet"
            example="Chats appear here once visitors talk to the bot on your website."
          />
        )
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/conversations/${c.id}`}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{visitorLabel(c.visitorId)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(c.lastMessageAt)}
                  </span>
                </div>
                <p className="truncate text-sm">
                  {c.firstMessage ? `“${c.firstMessage}”` : "—"}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3" /> {c.messageCount} messages
                  </span>
                  {c.rating !== null && (
                    <span className="flex items-center gap-1">
                      <Star className="size-3" /> {c.rating}
                    </span>
                  )}
                  {c.leadId && (
                    <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-500">
                      <UserRound className="size-3" /> lead
                    </Badge>
                  )}
                  {c.hasFallback && (
                    <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="size-3" /> fallback
                    </Badge>
                  )}
                  {c.originUrl && (
                    <span className="truncate">{originLabel(c.originUrl)}</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <Button variant="outline" className="mx-auto" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
