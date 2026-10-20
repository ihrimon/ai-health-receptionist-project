"use client";

import { useEffect, useState } from "react";
import { canChat, llmKeysApi } from "@/lib/llm-keys";
import { useSession } from "@/lib/session";

/**
 * Whether the workspace can chat: true/false for the owner (who can see
 * the keys), null for everyone else, undefined while loading.
 */
/** The Overview asks from several components at once; share one request. */
const SHARE_MS = 3000;
let shared: { at: number; promise: ReturnType<typeof llmKeysApi.list> } | null =
  null;

function listKeysShared() {
  if (!shared || Date.now() - shared.at > SHARE_MS) {
    shared = { at: Date.now(), promise: llmKeysApi.list() };
  }
  return shared.promise;
}

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
    listKeysShared().then(
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
