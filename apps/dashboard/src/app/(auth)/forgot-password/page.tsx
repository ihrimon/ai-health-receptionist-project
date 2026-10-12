"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/api";

/**
 * M1-26. The API answers 204 whether or not the email has an account, so
 * the page always shows the same "check your inbox" message.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many requests for this email. Please try again later."
          : (err as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }

  const backToLogin = (
    <Link href="/login" className="text-foreground underline">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title="Check your inbox" footer={backToLogin}>
        <p className="text-sm text-muted-foreground">
          If an account exists for <strong>{email}</strong>, we&apos;ve sent a
          link to reset your password. It&apos;s valid for 1 hour.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you a reset link."
      footer={backToLogin}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
