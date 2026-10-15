"use client";

import { CircleCheck, Circle, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatbot } from "@/lib/chatbot";
import { knowledgeApi } from "@/lib/knowledge";
import { onboardingProgress, onboardingSteps } from "@/lib/onboarding";
import { productsApi } from "@/lib/products";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

interface Counts {
  knowledge: number;
  products: number;
}

/**
 * "Let's get your assistant live" (D-3 §3.1, M2-17): steps tick themselves
 * from real data. Once everything possible today is done, it collapses to
 * a short "you're live" card (stats arrive with conversations, M5).
 */
export function OnboardingChecklist() {
  const { me } = useSession();
  const { chatbot, publish } = useChatbot();
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const [counts, setCounts] = useState<Counts | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      knowledgeApi.listFaqs(),
      knowledgeApi.listSources(),
      productsApi.list({ limit: 1 }),
    ]).then(
      ([faqs, sources, products]) => {
        if (cancelled) return;
        setCounts({
          knowledge:
            faqs.length +
            sources.filter((s) => s.type === "POLICY" || s.type === "TEXT").length,
          products: products.items.length,
        });
      },
      (err: Error) => toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [me.activeWorkspace?.id]);

  if (!chatbot || !counts) return <Skeleton className="h-80 w-full" />;

  const steps = onboardingSteps({
    businessDescription: chatbot.draftConfig.business.description,
    knowledgeCount: counts.knowledge,
    productCount: counts.products,
    published: chatbot.publishedVersion !== null,
  });
  const progress = onboardingProgress(steps);
  const reasons = chatbot.publishProblems.map((p) => p.message);

  async function handlePublish() {
    setPublishing(true);
    try {
      await publish();
      toastSuccess("Published. Your chatbot is live.");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (progress.readyForNow) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3">
          <PartyPopper className="size-6 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium">Your chatbot is published.</p>
            <p className="text-muted-foreground">
              Keep your FAQs and products up to date. Installing it on your
              website and conversation stats are coming soon.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Let&apos;s get your assistant live</CardTitle>
        <CardDescription>
          {progress.done} of {progress.total} done
        </CardDescription>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-1">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-lg px-2 py-2",
                !step.available && "opacity-60",
              )}
            >
              {step.done ? (
                <CircleCheck className="size-5 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="size-5 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("flex-1 text-sm", step.done && "text-muted-foreground line-through")}>
                {i + 1}. {step.title}
              </span>
              {!step.available ? (
                <span className="text-xs text-muted-foreground">Coming soon</span>
              ) : step.id === "publish" ? (
                !step.done &&
                canEdit && (
                  <span className="flex flex-col items-end gap-1">
                    <Button
                      size="sm"
                      disabled={reasons.length > 0 || publishing}
                      onClick={handlePublish}
                    >
                      {publishing ? "Publishing…" : "Publish"}
                    </Button>
                    {reasons.length > 0 && (
                      <span className="text-right text-xs text-muted-foreground">
                        {reasons[0]}
                      </span>
                    )}
                  </span>
                )
              ) : (
                !step.done &&
                step.href && (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={step.href}>{step.action} →</Link>}
                  />
                )
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
