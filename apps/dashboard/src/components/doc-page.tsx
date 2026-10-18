import Link from "next/link";
import { MessageCircle } from "lucide-react";

/**
 * Shared frame for the public reading pages: help articles (M7-13) and the
 * Terms and Privacy Policy (M7-14). They sit outside /app and /admin, so
 * they open without signing in (the proxy only guards those two).
 */
export function DocPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
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
        <div className="mt-8 space-y-4 text-[15px] leading-relaxed [&_a]:underline [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ol_li]:list-decimal [&_ul]:space-y-1.5 [&_ol]:space-y-1.5">
          {children}
        </div>
      </div>
      <DocFooter />
    </div>
  );
}

export function DocFooter() {
  return (
    <footer className="border-t py-6 text-center text-sm text-muted-foreground">
      <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        <Link href="/help" className="hover:text-foreground">
          Help
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms of Service
        </Link>
        <Link href="/privacy" className="hover:text-foreground">
          Privacy Policy
        </Link>
      </nav>
    </footer>
  );
}

/** Contact address shown in the legal pages (also the one in the help). */
export const CONTACT_EMAIL = "contact.brainstack@gmail.com";
