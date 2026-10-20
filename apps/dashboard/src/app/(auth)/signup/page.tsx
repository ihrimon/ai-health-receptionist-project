"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { EMAIL_FEATURES_ENABLED } from "@/lib/features";

// Matches the API's rule (D-2 §2.1); the API also rejects common passwords.
const PASSWORD_MIN_LENGTH = 10;

/** M1-26, D-3 §1.1: creates the account, workspace and chatbot in one go. */
export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      });
      // Without email there is nothing to confirm: go straight to sign in
      // (the same for a new and an existing address, M7-21).
      if (EMAIL_FEATURES_ENABLED) setDone(true);
      else router.replace("/login?created=1");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  // M7-21: the same screen whether or not the address already had an
  // account, so signup can't be used to find out who is registered.
  if (done) {
    return (
      <AuthCard
        title="Check your email"
        description={`We sent a message to ${form.email}. Open it to confirm your address, then sign in.`}
        footer={
          <Link href="/login" className="text-foreground underline">
            Go to sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Nothing there after a few minutes? Check your spam folder.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up a chatbot for your business in a few minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-foreground underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field
          id="name"
          label="Your name"
          autoComplete="name"
          value={form.name}
          onChange={set("name")}
          autoFocus
        />
        <Field
          id="companyName"
          label="Company name"
          autoComplete="organization"
          value={form.companyName}
          onChange={set("companyName")}
        />
        <Field
          id="email"
          label="Work email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={set("email")}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={form.password}
          onChange={set("password")}
        />
        <FormError message={error} />
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline">
            Terms of Service
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  );
}

function Field({
  id,
  label,
  hint,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  hint?: string;
  onChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "onChange" | "id">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required
        onChange={(e) => onChange(e.target.value)}
        {...input}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
