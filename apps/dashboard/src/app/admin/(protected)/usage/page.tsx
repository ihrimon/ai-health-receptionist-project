"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  formatTokens,
  formatUsd,
  PLAN_LABELS,
  sortUsageRows,
  usageApi,
  type UsageAssumptions,
  type UsageCost,
  type UsageDetail,
  type UsageOverview,
  type UsageSortKey,
} from "@/lib/admin";
import { toastError } from "@/lib/toast";

const COLUMNS: { key: UsageSortKey; label: string; right: boolean }[] = [
  { key: "name", label: "Company", right: false },
  { key: "conversations", label: "Conversations", right: true },
  { key: "messages", label: "Messages", right: true },
  { key: "leads", label: "Leads", right: true },
  { key: "tokens", label: "Tokens in+out", right: true },
  { key: "estimatedCostUsd", label: "Est. LLM cost", right: true },
  { key: "revenueUsd", label: "Plan revenue", right: true },
  { key: "profitUsd", label: "Est. profit", right: true },
];

/**
 * Super-admin usage and cost (M6-12): counts and token sums per workspace
 * for this month, platform totals, and a profit estimate. Every money value
 * is an estimate: tokens come from our own counters, prices from
 * configuration, revenue from the manual plan label (real revenue comes
 * with billing). No message text is shown or fetched.
 */
export default function AdminUsagePage() {
  const [data, setData] = useState<UsageOverview | null>(null);
  const [sort, setSort] = useState<{ key: UsageSortKey; asc: boolean }>({
    key: "estimatedCostUsd",
    asc: false,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const closeDetail = useCallback(() => setOpenId(null), []);

  useEffect(() => {
    let cancelled = false;
    usageApi.overview().then(
      (res) => !cancelled && setData(res),
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function sortBy(key: UsageSortKey) {
    setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === "name" }));
  }

  const rows = data ? sortUsageRows(data.items, sort.key, sort.asc) : [];

  return (
    <div className="mx-auto grid w-full max-w-6xl content-start gap-4 overflow-y-auto p-4 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Usage &amp; cost</h2>
        <p className="text-sm text-muted-foreground">
          {data ? `This month (${data.period}, UTC). ` : ""}
          All money values are estimates, not real billing. Counts only; no
          conversation text is shown here.
        </p>
      </div>

      {data === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Totals totals={data.totals} count={data.workspaceCount} />
          <Assumptions a={data.assumptions} />
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <TableHead
                      key={c.key}
                      className={c.right ? "text-right" : undefined}
                      aria-sort={
                        sort.key === c.key ? (sort.asc ? "ascending" : "descending") : "none"
                      }
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => sortBy(c.key)}
                      >
                        {c.label}
                        {sort.key === c.key &&
                          (sort.asc ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          ))}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead>Plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.workspaceId}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setOpenId(r.workspaceId)}
                    onKeyDown={(e) => e.key === "Enter" && setOpenId(r.workspaceId)}
                  >
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.conversations}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.messages}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(r.tokensIn + r.tokensOut)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(r.estimatedCostUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.revenueUsd)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${r.profitUsd < 0 ? "text-destructive" : ""}`}
                    >
                      {formatUsd(r.profitUsd)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{PLAN_LABELS[r.plan]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {openId && <DetailSheet id={openId} onClose={closeDetail} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Totals({ totals, count }: { totals: UsageCost; count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Stat label="Workspaces" value={String(count)} />
      <Stat
        label="Conversations"
        value={String(totals.conversations)}
        hint={`${totals.leads} leads`}
      />
      <Stat
        label="Messages"
        value={String(totals.messages)}
        hint={`${formatTokens(totals.tokensIn + totals.tokensOut)} tokens`}
      />
      <Stat
        label="Est. LLM cost (all chat)"
        value={formatUsd(totals.estimatedCostUsd)}
        hint={`On platform keys ${formatUsd(totals.platformCostUsd)} · on company keys ${formatUsd(totals.ownKeyCostUsd)}`}
      />
      <Stat label="Plan revenue (manual, est.)" value={formatUsd(totals.revenueUsd)} />
      <Stat
        label="Est. profit / loss"
        value={formatUsd(totals.profitUsd)}
        hint="Plan revenue minus the cost on platform keys"
      />
    </div>
  );
}

function Assumptions({ a }: { a: UsageAssumptions }) {
  return (
    <p className="text-xs text-muted-foreground">
      Assumptions: ${a.llmPriceInPerMillion} / ${a.llmPriceOutPerMillion} per million input / output
      tokens (one average price, not per model); {Math.round(a.platformKeyShare * 100)}% of chat on a
      platform key (companies use their own LLM key, so the platform pays nothing for chat unless
      this is raised); plan prices Starter ${a.planPriceUsd.STARTER}, Growth ${a.planPriceUsd.GROWTH},
      Beta $0 per month. Hosting, embeddings and email are not included. Real revenue arrives with
      billing.
    </p>
  );
}

function DetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<UsageDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    usageApi.workspace(id).then(
      (res) => !cancelled && setDetail(res),
      (err: Error) => {
        if (cancelled) return;
        toastError(err.message);
        onClose();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{detail?.workspace.name ?? "Usage"}</SheetTitle>
          <SheetDescription>
            Last six months. Estimates only; counts and token sums, never message text.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {detail === null ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                  <TableHead className="text-right">Msgs</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Tokens in / out</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead className="text-right">On platform key</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.months.map((m) => (
                  <TableRow key={m.period}>
                    <TableCell>{m.period}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.conversations}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.messages}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.leads}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokens(m.tokensIn)} / {formatTokens(m.tokensOut)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(m.estimatedCostUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(m.platformCostUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(m.revenueUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(m.profitUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {detail && (
            <p className="mt-3 text-xs text-muted-foreground">
              Revenue uses the current plan ({PLAN_LABELS[detail.workspace.plan]}) for every month.
              Msgs are live visitor answers; Test chat tokens are in the cost but not in Msgs. Past
              plan changes are not tracked.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
