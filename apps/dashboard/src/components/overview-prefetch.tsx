"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { analyticsApi } from "@/lib/analytics";
import { apiFetch } from "@/lib/api";
import { knowledgeApi } from "@/lib/knowledge";
import { overviewKey, prefetch } from "@/lib/prefetch";
import { productsApi } from "@/lib/products";

/**
 * On the Overview page, starts its requests while `/auth/me` is still
 * loading instead of after it (M7-37). It sits outside the session
 * provider on purpose, so it runs at the same time. It renders nothing.
 */
export function OverviewPrefetch() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/app") return;
    prefetch(overviewKey.chatbot, () => apiFetch("/chatbot"));
    for (const days of [7, 14, 30]) {
      prefetch(overviewKey.analytics(days), () => analyticsApi.overview(days));
    }
    prefetch(overviewKey.topQuestions(30), () => analyticsApi.topQuestions(30));
    prefetch(overviewKey.faqs, () => knowledgeApi.listFaqs());
    prefetch(overviewKey.sources, () => knowledgeApi.listSources());
    prefetch(overviewKey.products, () => productsApi.list({ limit: 1 }));
  }, [pathname]);

  return null;
}
