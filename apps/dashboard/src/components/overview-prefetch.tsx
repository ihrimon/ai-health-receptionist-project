"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { analyticsApi } from "@/lib/analytics";
import { apiFetch } from "@/lib/api";
import { overviewKey, prefetch } from "@/lib/prefetch";

/**
 * On the Overview page, starts the first screen's requests while `/auth/me` is still
 * loading instead of after it (M7-37). It sits outside the session
 * provider on purpose, so it runs at the same time. It renders nothing.
 */
export function OverviewPrefetch() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/app") return;
    prefetch(overviewKey.chatbot, () => apiFetch("/chatbot"));
    // Only the first screen (the hero: this week and the week before). The
    // sections below it load when they scroll into view.
    for (const days of [7, 14]) {
      prefetch(overviewKey.analytics(days), () => analyticsApi.overview(days));
    }
  }, [pathname]);

  return null;
}
