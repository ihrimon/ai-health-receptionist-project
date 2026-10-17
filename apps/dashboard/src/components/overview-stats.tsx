"use client";

import type { AnalyticsDay, AnalyticsOverview, AnalyticsTopQuestions } from "@brainstack/shared";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyticsApi,
  chartMax,
  formatAskedAt,
  formatMetric,
  formatRate,
  METRIC_LABELS,
  metricValue,
  type OverviewMetric,
  RANGE_PRESETS,
  type RangePreset,
  shortDay,
} from "@/lib/analytics";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";

const METRICS: OverviewMetric[] = ["conversations", "messages", "leads", "avgRating"];

/**
 * Home overview (D-3 §1.2, M5-8): totals for the last 7, 30 or 90 days and
 * a daily bar chart of one of them. Counts live chats only (no Test chat,
 * no empty chats), in UTC days.
 */
export function OverviewStats() {
  const { me } = useSession();
  const [days, setDays] = useState<RangePreset>(30);
  const [metric, setMetric] = useState<OverviewMetric>("conversations");
  const [data, setData] = useState<{ days: number; overview: AnalyticsOverview } | null>(
    null,
  );

  // A newer range can finish before an older one; only the latest counts.
  useEffect(() => {
    let cancelled = false;
    analyticsApi.overview(days).then(
      (overview) => !cancelled && setData({ days, overview }),
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [days, me.activeWorkspace?.id]);

  const overview = data?.days === days ? data.overview : null;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>Overview</CardTitle>
          <CardDescription>
            Chats on your website, by day (UTC). Test chats aren&apos;t counted.
          </CardDescription>
        </div>
        <div role="group" aria-label="Date range" className="flex gap-1">
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={preset === days ? "default" : "outline"}
              aria-pressed={preset === days}
              onClick={() => setDays(preset)}
            >
              {preset} days
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {overview ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METRICS.map((m) => (
                <StatTile
                  key={m}
                  metric={m}
                  overview={overview}
                  selected={m === metric}
                  onSelect={() => setMetric(m)}
                />
              ))}
            </div>
            <DailyChart daily={overview.daily} metric={metric} />
            <TopQuestions days={days} />
          </>
        ) : (
          <div className="grid gap-4" aria-busy="true">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METRICS.map((m) => (
                <Skeleton key={m} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-48" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatTile({
  metric,
  overview,
  selected,
  onSelect,
}: {
  metric: OverviewMetric;
  overview: AnalyticsOverview;
  selected: boolean;
  onSelect: () => void;
}) {
  const fallback = formatRate(overview.fallbackRate);
  const note =
    metric === "avgRating"
      ? `${overview.ratings.toLocaleString("en-US")} rated`
      : metric === "messages" && fallback
        ? `${fallback} fallback answers`
        : null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "grid gap-0.5 rounded-lg border p-3 text-left transition-colors outline-none",
        "hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary bg-muted/40" : "border-border",
      )}
    >
      <span className="text-xs text-muted-foreground">{METRIC_LABELS[metric].title}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {formatMetric(overview[metric], metric)}
      </span>
      <span className="min-h-4 text-xs text-muted-foreground">{note}</span>
    </button>
  );
}

/**
 * One bar per day (HTML bars, so they stay crisp at any width and follow
 * the light/dark theme tokens). Hover or focus a day to read its value;
 * the same numbers are in the table below for screen readers.
 */
function DailyChart({ daily, metric }: { daily: AnalyticsDay[]; metric: OverviewMetric }) {
  const [active, setActive] = useState<number | null>(null);
  const values = daily.map((d) => metricValue(d, metric));
  const max = chartMax(values, metric);
  const { title, unit } = METRIC_LABELS[metric];
  const empty = values.every((v) => !v);
  const shown = active !== null ? daily[active] : null;
  const first = daily[0];
  const last = daily.at(-1);

  const describe = (day: AnalyticsDay) =>
    `${shortDay(day.date)}: ${formatMetric(metricValue(day, metric), metric)} ${
      metric === "avgRating" && day.avgRating === null ? "(no ratings)" : unit
    }`;

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{title} per day</span>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {shown ? describe(shown) : "Hover a day to see its value"}
        </span>
      </div>

      <div className="relative flex h-40 gap-2">
        {/* Axis labels and recessive grid lines: top, middle, zero. */}
        <div
          aria-hidden
          className="flex w-8 shrink-0 flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums"
        >
          <span>{formatMetric(max, metric === "avgRating" ? metric : "messages")}</span>
          <span>{formatMetric(max / 2, metric === "avgRating" ? metric : "messages")}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1">
          <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
            <div className="border-t border-dashed border-border" />
            <div className="border-t border-dashed border-border" />
            <div className="border-t border-border" />
          </div>
          <div
            role="img"
            aria-label={`${title} per day, ${shortDay(first.date)} to ${shortDay(
              last?.date ?? first.date,
            )}. Values are in the table below.`}
            className={cn(
              "absolute inset-0 flex items-end",
              daily.length > 45 ? "gap-px" : "gap-0.5",
            )}
            onMouseLeave={() => setActive(null)}
          >
            {daily.map((day, i) => {
              const value = values[i];
              return (
                <div
                  key={day.date}
                  title={describe(day)}
                  className="group flex h-full min-w-0 flex-1 cursor-default items-end"
                  onMouseEnter={() => setActive(i)}
                >
                  {value ? (
                    <div
                      className={cn(
                        "w-full rounded-t-[4px] bg-chart-1 transition-opacity",
                        active !== null && active !== i ? "opacity-50" : "opacity-100",
                      )}
                      style={{ height: `${Math.max((value / max) * 100, 2)}%` }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {empty && (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Nothing in this range yet.
            </p>
          )}
        </div>
      </div>
      <div
        aria-hidden
        className="ml-10 flex justify-between text-[10px] text-muted-foreground tabular-nums"
      >
        <span>{shortDay(first.date)}</span>
        {last && last !== first && <span>{shortDay(last.date)}</span>}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Show as table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Daily numbers (UTC days)</caption>
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th scope="col" className="p-2 font-medium">Day</th>
                {METRICS.map((m) => (
                  <th key={m} scope="col" className="p-2 text-right font-medium">
                    {METRIC_LABELS[m].title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date} className="border-t">
                  <th scope="row" className="p-2 text-left font-normal">
                    {shortDay(day.date)}
                  </th>
                  {METRICS.map((m) => (
                    <td key={m} className="p-2 text-right">
                      {formatMetric(metricValue(day, m), m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/**
 * The questions visitors ask most in the chosen range (M5-9). Identical
 * wording (ignoring case and punctuation) is counted together; questions
 * that mean the same in different words are not grouped yet.
 */
function TopQuestions({ days }: { days: RangePreset }) {
  const { me } = useSession();
  const [data, setData] = useState<{ days: number; result: AnalyticsTopQuestions } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    analyticsApi.topQuestions(days).then(
      (result) => !cancelled && setData({ days, result }),
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [days, me.activeWorkspace?.id]);

  const result = data?.days === days ? data.result : null;

  return (
    <section className="grid gap-2" aria-labelledby="top-questions-title">
      <h3 id="top-questions-title" className="text-sm font-medium">
        Top questions
      </h3>
      {!result ? (
        <Skeleton className="h-24" aria-busy="true" />
      ) : result.questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions in this range yet.</p>
      ) : (
        <>
          <ol className="divide-y rounded-md border text-sm">
            {result.questions.map((q, i) => (
              <li key={`${i}-${q.example}`} className="flex items-start gap-3 p-2">
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums">
                  {q.count.toLocaleString("en-US")}×
                </span>
                <span className="min-w-0 flex-1 break-words">{q.example}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatAskedAt(q.lastAskedAt)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Same wording is counted together (ignoring case and punctuation); greetings and
            very short messages are skipped.
            {result.truncated && " Only the newest messages in this range were checked."}
          </p>
        </>
      )}
    </section>
  );
}
