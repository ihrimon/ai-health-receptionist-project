"use client";

import type { ChatbotConfig } from "@brainstack/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import type { PublishInfo } from "@/lib/config-form";
import { useSession } from "@/lib/session";

/** GET /v1/chatbot (D-2 §2.2): the workspace's one chatbot. */
export interface ChatbotView extends PublishInfo {
  id: string;
  publicId: string;
  status: "ENABLED" | "DISABLED";
  draftConfig: ChatbotConfig;
  allowedDomains: string[];
  /** First widget load on an allowed domain (M4-14); null until then. */
  installVerifiedAt: string | null;
  installVerifiedHost: string | null;
  embedSnippet: string;
}

interface ChatbotValue {
  /** null while loading, or if loading failed (see `error`). */
  chatbot: ChatbotView | null;
  error: string | null;
  /** Saves the editor's draft; the live bot changes only on publish. */
  saveDraft: (config: ChatbotConfig) => Promise<void>;
  publish: () => Promise<void>;
  /** Resets the draft to the live config. */
  discardDraft: () => Promise<void>;
  setStatus: (status: ChatbotView["status"]) => Promise<void>;
  /** Replaces the embed allow-list; applies at once, no publish needed. */
  setAllowedDomains: (domains: string[]) => Promise<void>;
  /** Reloads, e.g. after knowledge changed what publishing needs. */
  refresh: () => Promise<void>;
}

const ChatbotContext = createContext<ChatbotValue | null>(null);

/**
 * Holds the current workspace's chatbot for the whole dashboard, so the
 * editor (M2-18) and the header's publish banner (M2-20) always show the
 * same state: saving in the editor updates the banner at once.
 */
export function ChatbotProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const workspaceId = me.activeWorkspace?.id;
  const [chatbot, setChatbot] = useState<ChatbotView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => apiFetch<ChatbotView>("/chatbot"), []);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    load().then(
      (loaded) => {
        if (cancelled) return;
        setChatbot(loaded);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
    // Reload when the user switches workspace.
  }, [workspaceId, load]);

  // Every write returns the updated chatbot; keep it as the new state.
  const write = useCallback(
    async (path: string, method: string, body?: unknown) => {
      setChatbot(
        await apiFetch<ChatbotView>(path, {
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    },
    [],
  );

  const value: ChatbotValue = {
    chatbot,
    error,
    saveDraft: (config) => write("/chatbot/draft", "PUT", config),
    publish: () => write("/chatbot/publish", "POST"),
    discardDraft: () => write("/chatbot/discard-draft", "POST"),
    setStatus: (status) => write("/chatbot/status", "PATCH", { status }),
    setAllowedDomains: (domains) =>
      write("/chatbot/allowed-domains", "PUT", { domains }),
    refresh: async () => setChatbot(await load()),
  };

  return (
    <ChatbotContext.Provider value={value}>{children}</ChatbotContext.Provider>
  );
}

export function useChatbot(): ChatbotValue {
  const value = useContext(ChatbotContext);
  if (!value) throw new Error("useChatbot() outside ChatbotProvider");
  return value;
}
