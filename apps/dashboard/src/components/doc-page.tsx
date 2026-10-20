import { DocFrame, DocLink } from "@/components/doc-frame";

/**
 * Shared frame for the reading pages: help articles (M7-13) and the Terms and
 * Privacy Policy (M7-14). They are public (outside /app and /admin, so they
 * open without signing in) and are also served under /app so the dashboard's
 * Help menu stays inside the dashboard.
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
    <DocFrame title={title} intro={intro} footer={<DocFooter />}>
      {children}
    </DocFrame>
  );
}

export function DocFooter() {
  return (
    <footer className="border-t py-6 text-center text-sm text-muted-foreground">
      <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        <DocLink href="/help" className="hover:text-foreground">
          Help
        </DocLink>
        <DocLink href="/terms" className="hover:text-foreground">
          Terms of Service
        </DocLink>
        <DocLink href="/privacy" className="hover:text-foreground">
          Privacy Policy
        </DocLink>
      </nav>
    </footer>
  );
}

/** Contact address shown in the legal pages (also the one in the help). */
export const CONTACT_EMAIL = "contact.brainstack@gmail.com";
