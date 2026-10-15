"use client";

import { useEffect, useState } from "react";
import { canChat, llmKeysApi } from "@/lib/llm-keys";
import { useSession } from "@/lib/session";

/**
 * Whether the workspace can chat: true/false for the owner (who can see
 * the keys), null for everyone else, undefined while loading.
 */
export function useAiKeyReady(): boolean | null | undefined {
  const { me } = useSession();
  const isOwner = me.role === "OWNER";
  const workspaceId = me.activeWorkspace?.id;
  const [state, setState] = useState<{ for?: string; ready?: boolean | null }>(
    {},
  );

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    llmKeysApi.list().then(
      (keys) => !cancelled && setState({ for: workspaceId, ready: canChat(keys) }),
      // Unknown is better than blocking the page on a failed check.
      () => !cancelled && setState({ for: workspaceId, ready: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [isOwner, workspaceId]);

  if (!isOwner) return null;
  return state.for === workspaceId ? state.ready : undefined;
}
