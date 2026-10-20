"use client";

import type { AnalyticsOverview } from "@brainstack/shared";
import {
  ArrowRight,
  MessageCircleQuestion,
  MessagesSquare,
  Rocket,
  Star,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsApi, formatRate, metricValue, type OverviewMetric } from "@/lib/analytics";
import { useChatbot } from "@/lib/chatbot";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";
import { overviewKey, takeOrFetch } from "@/lib/prefetch";
import { useAiKeyReady } from "@/lib/use-ai-key-ready";
import { cn } from "@/lib/utils";

const WEEK = 7;

interface Weeks {
  /** The last 7 days. */
  now: AnalyticsOverview;
  /** The 14 days ending today; the first 7 are the week before. */
  both: AnalyticsOverview;
}

function sum(overview: AnalyticsOverview, metric: OverviewMetric, from: number, to: number) {
  return overview.daily
    .slice(from, to)
    .reduce((total, day) => total + (metricValue(day, metric) ?? 0), 0);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "+12%" / "-8%" against the week before; null when there's nothing to compare. */
function change(now: number, before: number): { label: string; up: boolean } | null {
  if (now === 0 && before === 0) return null;
  if (before === 0) return { label: "New", up: true };
  const pct = Math.round(((now - before) / before) * 100);
  return { label: `${pct > 0 ? "+" : ""}${pct}%`, up: pct >= 0 };
}

function Delta({ value }: { value: { label: string; up: boolean } | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">No change</span>;
  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums",
        value.up ? "text-primary" : "text-destructive",
      )}
    >
      {value.label} vs last week
    </span>
  );
}

/** A tiny trend line; decorative, the numbers are in the text next to it. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="h-8 w-20 shrink-0 text-primary"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TrendTile({
  label,
  value,
  values,
  delta,
}: {
  label: string;
  value: number;
  values: number[];
  delta: ReturnType<typeof change>;
}) {
  return (
    <div className="grid gap-1 rounded-xl border bg-card p-3 shadow-xs">
      <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums">{value.toLocaleString("en-US")}</span>
        <Sparkline values={values} />
      </div>
      <Delta value={delta} />
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" />
        </span>
        <span className="truncate text-xs text-muted-foreground">{note}</span>
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Bar({ label, percent }: { label: string; percent: number | null }) {
  return (
    <div className="grid gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The top of Overview: a headline that says how the week went, trend tiles,
 * a "next step" card, a few rates, and setup/quality bars. Everything comes
 * from the overview numbers (last 7 days against the 7 before) and the
 * chatbot's own state; nothing here is a plan or a target.
 */
export function OverviewHero() {
  const { me } = useSession();
  const { chatbot } = useChatbot();
  const aiKeyReady = useAiKeyReady();
  const [weeks, setWeeks] = useState<(Weeks & { for?: string }) | null>(null);
  const workspaceId = me.activeWorkspace?.id;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      takeOrFetch(overviewKey.analytics(WEEK), () => analyticsApi.overview(WEEK)),
      takeOrFetch(overviewKey.analytics(WEEK * 2), () =>
        analyticsApi.overview(WEEK * 2),
      ),
    ]).then(
      ([now, both]) => !cancelled && setWeeks({ now, both, for: workspaceId }),
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!weeks || weeks.for !== workspaceId || !chatbot) {
    return <Skeleton className="h-96 w-full rounded-2xl" aria-busy="true" />;
  }

  const { now, both } = weeks;
  const published = chatbot.publishedVersion !== null;
  const installed = chatbot.installVerifiedAt !== null;
  const series = (metric: OverviewMetric) =>
    now.daily.map((d) => metricValue(d, metric) ?? 0);
  const delta = (metric: OverviewMetric) =>
    change(sum(both, metric, WEEK, WEEK * 2), sum(both, metric, 0, WEEK));

  // The headline: how it went, or what's left to do.
  const [line1, line2] = !published
    ? ["Your assistant is almost ready.", "Finish setup and go live."]
    : now.conversations === 0
      ? ["Your assistant is live.", "Waiting for the first visitor."]
      : [
          `${plural(now.conversations, "conversation")} this week.`,
          now.leads > 0
            ? `${plural(now.leads, "new lead")} captured.`
            : "Every question, answered.",
        ];

  // One next step, in the order a company would do them.
  const next =
    aiKeyReady === false
      ? { text: "Add your AI key so the assistant can reply.", href: "/app/settings/ai", cta: "Add API key" }
      : !published
        ? { text: "Check your chatbot and publish it.", href: "/app/chatbot", cta: "Open chatbot" }
        : !installed
          ? { text: "Add the chatbot to your website.", href: "/app/settings/install", cta: "Install chatbot" }
          : { text: "Everything is set up. See what visitors are asking.", href: "/app/conversations", cta: "View conversations" };

  const setupFlags = [
    aiKeyReady !== false,
    chatbot.draftConfig.business.description.trim() !== "",
    published,
    installed,
  ];
  const setup = Math.round((setupFlags.filter(Boolean).length / setupFlags.length) * 100);
  const covered = now.fallbackRate === null ? null : Math.round((1 - now.fallbackRate) * 100);
  const rating = now.avgRating === null ? null : Math.round((now.avgRating / 5) * 100);
  const conversion =
    now.conversations === 0 ? null : Math.min(100, Math.round((now.leads / now.conversations) * 100));
  const perChat = now.conversations === 0 ? "—" : (now.messages / now.conversations).toFixed(1);

  return (
    <section
      aria-label="This week at a glance"
      className="overflow-hidden rounded-2xl border bg-linear-to-br from-accent/70 via-card to-card shadow-xs"
    >
      <div className="grid lg:grid-cols-[1.35fr_1fr]">
        <div className="grid content-start gap-5 p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <span className="rounded-full bg-accent px-2.5 py-1 text-accent-foreground">
              {published ? "Chatbot live" : "Not published yet"}
            </span>
            <span className="rounded-full bg-accent px-2.5 py-1 text-accent-foreground">
              {installed ? "Installed on your site" : "Not installed yet"}
            </span>
            <span className="text-muted-foreground">Last 7 days</span>
          </div>
          <div className="grid gap-3">
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              This week
            </p>
            <h3 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-5xl">
              {line1}
              <span className="block text-primary">{line2}</span>
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <TrendTile
              label="Conversations"
              value={now.conversations}
              values={series("conversations")}
              delta={delta("conversations")}
            />
            <TrendTile
              label="Messages"
              value={now.messages}
              values={series("messages")}
              delta={delta("messages")}
            />
            <TrendTile
              label="Leads"
              value={now.leads}
              values={series("leads")}
              delta={delta("leads")}
            />
          </div>
        </div>

        <div className="grid content-start gap-3 border-t bg-card/60 p-5 sm:p-6 lg:border-t-0 lg:border-l">
          <div>
            <h3 className="text-sm font-semibold">Highlights</h3>
            <p className="text-xs text-muted-foreground">
              What matters most right now.
            </p>
          </div>
          <div className="grid gap-3 rounded-xl border bg-linear-to-br from-accent/60 to-card p-4 shadow-xs">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Rocket className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">Next step</div>
              <p className="text-sm text-muted-foreground">{next.text}</p>
            </div>
            <Link
              href={next.href}
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {next.cta}
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon={Star}
              label="Average rating"
              value={now.avgRating === null ? "—" : now.avgRating.toFixed(1)}
              note={`${now.ratings.toLocaleString("en-US")} rated`}
            />
            <StatTile
              icon={MessageCircleQuestion}
              label="Fallback answers"
              value={formatRate(now.fallbackRate) ?? "—"}
              note="of replies"
            />
            <StatTile
              icon={MessagesSquare}
              label="Messages per chat"
              value={perChat}
              note="average"
            />
            <StatTile
              icon={UserRound}
              label="Chats with a lead"
              value={conversion === null ? "—" : `${conversion}%`}
              note="of chats"
            />
          </div>
        </div>
      </div>

      <div className="grid divide-y border-t bg-card/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <Bar label="Setup complete" percent={setup} />
        <Bar label="Answered from your content" percent={covered} />
        <Bar label="Visitor rating" percent={rating} />
        <Bar label="Chats that became leads" percent={conversion} />
      </div>
    </section>
  );
}
