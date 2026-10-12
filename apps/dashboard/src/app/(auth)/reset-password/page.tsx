"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, clearDashboardSession } from "@/lib/api";

const PASSWORD_MIN_LENGTH = 10;

/** M1-26: the page the reset email links to (`?token=`). */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = (
    <Link href="/login" className="text-foreground underline">
      Go to sign in
    </Link>
  );

  if (!token) {
    return (
      <AuthCard title="Link is incomplete" footer={signIn}>
        <p className="text-sm text-muted-foreground">
          This reset link is missing its token. Please open the link from the
          email again, or{" "}
          <Link href="/forgot-password" className="underline">
            request a new one
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password updated" footer={signIn}>
        <p className="text-sm text-muted-foreground">
          Your password has been changed and you&apos;ve been signed out
          everywhere. Sign in with your new password.
        </p>
      </AuthCard>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      // The API ended every session of this user.
      clearDashboardSession();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" footer={signIn}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            At least {PASSWORD_MIN_LENGTH} characters.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Repeat new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthCard>
  );
}
