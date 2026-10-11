"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";

const TITLES: { prefix: string; title: string }[] = [
  { prefix: "/admin/conversations", title: "Conversations" },
  { prefix: "/admin/settings", title: "Settings" },
];

function titleFor(pathname: string): string {
  if (pathname === "/admin") return "Overview";
  return TITLES.find((t) => pathname.startsWith(t.prefix))?.title ?? "Dashboard";
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <h1 className="text-sm font-medium">{titleFor(pathname)}</h1>
      <div className="ml-auto flex items-center gap-2">
        <ModeToggle />
      </div>
    </header>
  );
}
