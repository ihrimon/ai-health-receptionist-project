"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { title: "Chatbot", href: "/app/settings/chatbot" },
  { title: "AI", href: "/app/settings/ai" },
  { title: "Workspace", href: "/app/settings/workspace" },
];

/**
 * Settings sections as sub-routes, so each one has its own link. The bar
 * looks like the editor's tabs but navigates.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
      <nav
        aria-label="Settings sections"
        className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-sm"
      >
        {SECTIONS.map((s) => {
          const active = pathname.startsWith(s.href);
          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground",
                active && "bg-background text-foreground shadow-sm",
              )}
            >
              {s.title}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
