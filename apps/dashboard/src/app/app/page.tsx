"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Home (M1-27): the onboarding checklist (M2-17, D-3 §3.1) until the
 * chatbot is set up and published.
 */
export default function AppHomePage() {
  const { me } = useSession();
  const firstName = me.user.name.split(" ")[0];

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">Welcome, {firstName}</h2>
        <p className="text-sm text-muted-foreground">
          {me.activeWorkspace
            ? `You're in ${me.activeWorkspace.name}.`
            : "You don't belong to a workspace yet."}
        </p>
      </div>

      {!me.user.emailVerifiedAt && <VerifyEmailBanner email={me.user.email} />}

      {me.activeWorkspace && <OnboardingChecklist key={me.activeWorkspace.id} />}
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
