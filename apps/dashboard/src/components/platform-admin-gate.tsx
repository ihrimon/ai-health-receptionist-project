"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

/**
 * The /admin pages (platform LLM keys, interim conversations) are for
 * platform admins only. The API enforces it (403); this just sends anyone
 * else to their own dashboard instead of showing a page of errors.
 */
export function PlatformAdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { me } = useSession();
  const allowed = me.user.isPlatformAdmin;

  useEffect(() => {
    if (!allowed) router.replace("/app");
  }, [allowed, router]);

  return allowed ? <>{children}</> : null;
}
