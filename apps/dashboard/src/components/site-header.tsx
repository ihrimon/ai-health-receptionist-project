"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";
import { PublishBanner } from "@/components/publish-banner";

const TITLES: { prefix: string; title: string }[] = [
  { prefix: "/app/chatbot", title: "Chatbot" },
  { prefix: "/app/knowledge", title: "Knowledge" },
  { prefix: "/app/products", title: "Products" },
  { prefix: "/app/conversations", title: "Conversations" },
  { prefix: "/app/leads", title: "Leads" },
  { prefix: "/app/unanswered", title: "Unanswered questions" },
  { prefix: "/app/settings", title: "Settings" },
  { prefix: "/admin/workspaces", title: "Workspaces" },
  { prefix: "/admin/conversations", title: "Conversations" },
  { prefix: "/admin/usage", title: "Usage & cost" },
  { prefix: "/admin/llm-credentials", title: "LLM keys" },
];

function titleFor(pathname: string): string {
  if (pathname === "/admin") return "Workspaces";
  if (pathname === "/app") return "Home";
  return TITLES.find((t) => pathname.startsWith(t.prefix))?.title ?? "Dashboard";
}

/** `withPublishBanner`: the company dashboard (/app) shows it, admin doesn't. */
export function SiteHeader({
  withPublishBanner = false,
}: {
  withPublishBanner?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <h1 className="text-sm font-medium">{titleFor(pathname)}</h1>
      <div className="ml-auto flex items-center gap-3">
        {withPublishBanner && <PublishBanner />}
        <ModeToggle />
      </div>
    </header>
  );
}
