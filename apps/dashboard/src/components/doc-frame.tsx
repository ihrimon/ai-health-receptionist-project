"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

const DOC_PREFIXES = ["/help", "/terms", "/privacy"];

/** Reading pages open inside the dashboard (/app/help…) when reached from it. */
function insideDashboard(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

/**
 * Where a help/legal link should go: the public page for visitors, the same
 * page under /app for someone using the dashboard, so Help never leaves it.
 */
export function docHref(href: string, pathname: string): string {
  const isDoc = DOC_PREFIXES.some(
    (p) => href === p || href.startsWith(`${p}/`),
  );
  return isDoc && insideDashboard(pathname) ? `/app${href}` : href;
}

/** `Link` that keeps help, terms and privacy links inside the dashboard. */
export function DocLink({ href, ...props }: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const to = typeof href === "string" ? docHref(href, pathname) : href;
  return <Link href={to} {...props} />;
}

const CONTENT_CLASSES =
  "mt-8 space-y-4 text-[15px] leading-relaxed [&_a]:underline [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ol_li]:list-decimal [&_ul]:space-y-1.5 [&_ol]:space-y-1.5";

/**
 * Frame of a reading page. Public (no sign-in): its own logo and footer.
 * Inside the dashboard: just the article, because the sidebar and header are
 * already there.
 */
export function DocFrame({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const pathname = usePathname();

  if (insideDashboard(pathname)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-3 text-muted-foreground">{intro}</p>}
        <div className={CONTENT_CLASSES}>{children}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link
          href="/"
          className="mb-8 flex items-center gap-2 text-sm font-semibold"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageCircle className="size-4" />
          </span>
          BrainStack
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-3 text-muted-foreground">{intro}</p>}
        <div className={CONTENT_CLASSES}>{children}</div>
      </div>
      {footer}
    </div>
  );
}
