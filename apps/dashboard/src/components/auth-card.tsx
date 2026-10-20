"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { warmUpApi } from "@/lib/api";

/** The centered card every sign-in/sign-up style page uses (D-3 §1.1). */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => warmUpApi(), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 text-sm font-semibold"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <MessageCircle className="size-4" />
        </span>
        BrainStack
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {footer}
        </p>
      )}
    </div>
  );
}

/** Inline error under a form. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
