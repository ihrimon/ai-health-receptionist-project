"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  apiFetch,
  ApiError,
  clearDashboardSession,
  type Me,
} from "@/lib/api";

interface SessionValue {
  me: Me;
  refresh: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Where to send a signed-out visitor, remembering the page they wanted. */
export function loginUrl(next?: string): string {
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/**
 * Loads the signed-in user (GET /v1/auth/me) for everything under it. This
 * is the real login check for the dashboard (M1-28): proxy.ts only looks
 * for the marker cookie. A 401 clears that marker and goes to /login.
 */
export function SessionProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const handleFailure = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        clearDashboardSession();
        router.replace(loginUrl(pathname));
        return;
      }
      setLoadError((err as Error).message);
    },
    [router, pathname],
  );

  const refresh = useCallback(async () => {
    try {
      setMe(await apiFetch<Me>("/auth/me"));
    } catch (err) {
      handleFailure(err);
    }
  }, [handleFailure]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Me>("/auth/me").then(
      (loaded) => {
        if (!cancelled) setMe(loaded);
      },
      (err: unknown) => {
        if (!cancelled) handleFailure(err);
      },
    );
    return () => {
      cancelled = true;
    };
    // Load on mount and on "Try again"; a route change doesn't need a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      await apiFetch("/workspaces/switch", {
        method: "POST",
        body: JSON.stringify({ workspaceId }),
      });
      await refresh();
      router.refresh();
    },
    [refresh, router],
  );

  const logout = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    clearDashboardSession();
    router.replace("/login");
  }, [router]);

  if (!me && loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t reach the server: {loadError}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setLoadError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (!me) return <>{fallback}</>;
  return (
    <SessionContext.Provider value={{ me, refresh, switchWorkspace, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession() outside <SessionProvider>");
  return value;
}

export { safeNext } from "./safe-next";
