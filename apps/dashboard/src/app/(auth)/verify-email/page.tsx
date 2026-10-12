"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { apiFetch } from "@/lib/api";

/** M1-26: the page the verification email links to (`?token=`). */
export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}

type State = { status: "checking" } | { status: "done" } | { status: "failed"; message: string };

function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>(
    token
      ? { status: "checking" }
      : { status: "failed", message: "This link is missing its token." },
  );
  // Tokens are single-use: don't send it twice when React runs effects
  // twice in development.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    apiFetch("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(() => setState({ status: "done" }))
      .catch((err: Error) =>
        setState({ status: "failed", message: err.message }),
      );
  }, [token]);

  const toDashboard = (
    <Link href="/app" className="text-foreground underline">
      Go to your dashboard
    </Link>
  );

  if (state.status === "checking") {
    return (
      <AuthCard title="Confirming your email…">
        <p className="text-sm text-muted-foreground">One moment.</p>
      </AuthCard>
    );
  }
  if (state.status === "done") {
    return (
      <AuthCard title="Email confirmed" footer={toDashboard}>
        <p className="text-sm text-muted-foreground">
          Thanks! Your email address is verified.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Couldn't confirm your email" footer={toDashboard}>
      <p className="text-sm text-muted-foreground">
        {state.message} You can send a new link from your dashboard.
      </p>
    </AuthCard>
  );
}
