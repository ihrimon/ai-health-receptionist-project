"use client";

import { useEffect, useState } from "react";
import { MailWarning } from "lucide-react";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { OverviewHero } from "@/components/overview-hero";
import { OverviewStats } from "@/components/overview-stats";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Home (M1-27): the onboarding checklist (M2-17, D-3 §3.1) until the
 * chatbot is set up and published, and the overview stats below it (M5-8).
 */
export default function AppHomePage() {
  const { me } = useSession();
  const firstName = me.user.name.split(" ")[0];
  const [greeting, setGreeting] = useState("Welcome");

  useEffect(() => {
    // Local time, so it is set after mount (the server clock may differ).
    const hour = new Date().getHours();
    Promise.resolve(
      hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening",
    ).then(setGreeting);
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">
          {greeting},{" "}
          <span className="font-medium text-foreground">{firstName}</span>
          {me.activeWorkspace
            ? `. Here's how ${me.activeWorkspace.name} is doing.`
            : ". You don't belong to a workspace yet."}
        </p>
      </div>

      {me.activeWorkspace && <OverviewHero key={`hero-${me.activeWorkspace.id}`} />}

      {!me.user.emailVerifiedAt && <VerifyEmailBanner email={me.user.email} />}

      {me.activeWorkspace && <OnboardingChecklist key={me.activeWorkspace.id} />}

      {me.activeWorkspace && <OverviewStats key={`stats-${me.activeWorkspace.id}`} />}
    </div>
  );
}

function VerifyEmailBanner({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend() {
    setSending(true);
    try {
      await apiFetch("/auth/resend-verification", { method: "POST" });
      setSent(true);
      toastSuccess(`Verification email sent to ${email}.`);
    } catch (err) {
      toastError(
        err instanceof ApiError && err.status === 429
          ? "You've asked for a few already. Please try again later."
          : (err as Error).message,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3">
        <MailWarning className="size-5 shrink-0 text-amber-500" />
        <p className="flex-1 text-sm">
          Please confirm your email address. We sent a link to{" "}
          <strong>{email}</strong>.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={sending || sent}
          onClick={resend}
        >
          {sent ? "Sent" : sending ? "Sending…" : "Resend link"}
        </Button>
      </CardContent>
    </Card>
  );
}
