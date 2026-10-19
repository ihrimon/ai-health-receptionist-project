"use client";

import type { AnalyticsUnanswered } from "@brainstack/shared";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/knowledge/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addToKnowledgeHref,
  analyticsApi,
  formatAskedAt,
  RANGE_PRESETS,
  type RangePreset,
} from "@/lib/analytics";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";

/**
 * Unanswered questions (D-3 §3.7, M5-10): what visitors asked when the bot
 * fell back (had no answer in its knowledge), grouped by wording. "Add to
 * knowledge" opens the FAQ form with the question filled in.
 */
export default function UnansweredPage() {
  const { me } = useSession();
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const [days, setDays] = useState<RangePreset>(30);
  const [data, setData] = useState<{ days: number; result: AnalyticsUnanswered } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    analyticsApi.unanswered(days).then(
      (result) => !cancelled && setData({ days, result }),
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [days, me.activeWorkspace?.id]);

  const result = data?.days === days ? data.result : null;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Unanswered questions</h2>
          <p className="text-sm text-muted-foreground">
            Questions your bot couldn&apos;t answer from its knowledge. Add the answer once
            and it will know next time.
          </p>
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
      </div>

      {!result ? (
        <Skeleton className="h-48" aria-busy="true" />
      ) : result.questions.length === 0 ? (
        <EmptyState
          title="Nothing unanswered in this range"
          example="When the bot can't answer a visitor, the question will show up here."
        />
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {result.questions.map((q) => (
              <li
                key={`${q.conversationId}-${q.example}`}
                className="flex flex-wrap items-start gap-3 p-3"
              >
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums">
                  {q.count.toLocaleString("en-US")}×
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words">{q.example}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    Last asked {formatAskedAt(q.lastAskedAt)} UTC ·{" "}
                    <Link
                      className="underline underline-offset-2"
                      href={`/app/conversations/${q.conversationId}`}
                    >
                      View conversation
                    </Link>
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <Link href={addToKnowledgeHref(q.example)}>
                        <Plus /> Add to knowledge
                      </Link>
                    }
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Same wording is counted together (ignoring case and punctuation); greetings and
            very short messages are skipped.
            {result.truncated && " Only the newest replies in this range were checked."}
          </p>
        </>
      )}
    </div>
  );
}
