"use client";

import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppearancePanel } from "@/components/appearance-panel";
import { ModeToggle } from "@/components/mode-toggle";
import { PageSearch } from "@/components/page-search";
import { PublishBanner } from "@/components/publish-banner";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

function SidebarToggle() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  const Icon = state === "expanded" && !isMobile ? PanelLeftClose : PanelLeftOpen;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle sidebar"
      onClick={toggleSidebar}
    >
      <Icon />
    </Button>
  );
}

/**
 * Top bar. Left: sidebar toggle, page search and the light/dark button.
 * Right: publish status, appearance and the signed-in person (a circle). `withPublishBanner`: the
 * company dashboard (/app) shows the banner and the chatbot color shortcut,
 * admin doesn't.
 */
export function SiteHeader({
  withPublishBanner = false,
}: {
  withPublishBanner?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-4">
      <SidebarToggle />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <PageSearch admin={pathname.startsWith("/admin")} />
        <ModeToggle />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {withPublishBanner && <PublishBanner />}
        <AppearancePanel withChatbot={withPublishBanner} />
        <UserMenu />
      </div>
    </header>
  );
}
