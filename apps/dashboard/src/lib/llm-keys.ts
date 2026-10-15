import type {
  CreateLlmKey,
  LlmKeyProvider,
  LlmKeyView,
  UpdateLlmKey,
} from "@brainstack/shared";
import { apiFetch } from "@/lib/api";

/* The workspace's own LLM API keys (M3-21): Settings → AI, owner only. */

export type LlmKey = LlmKeyView;

export const PROVIDER_LABELS: Record<LlmKeyProvider, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  groq: "Groq",
};

/** Where the owner gets a key for each provider. */
export const PROVIDER_KEY_PAGES: Record<LlmKeyProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
};

// Suggestions only: any model id the provider accepts can be typed, and
// the API checks it with a real call before saving.
export const SUGGESTED_MODELS: Record<LlmKeyProvider, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4.1"],
  gemini: ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.6-pro"],
  groq: [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
  ],
};

/** "…abcd": enough to tell keys apart, never the key. */
export function maskedKey(key: Pick<LlmKey, "keyLast4">): string {
  return `…${key.keyLast4}`;
}

/** Chat works when at least one key is switched on. */
export function canChat(keys: Pick<LlmKey, "isActive">[]): boolean {
  return keys.some((k) => k.isActive);
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const llmKeysApi = {
  list: () => apiFetch<LlmKey[]>("/llm-keys"),
  create: (body: CreateLlmKey) =>
    apiFetch<LlmKey>("/llm-keys", json("POST", body)),
  update: (id: string, body: UpdateLlmKey) =>
    apiFetch<LlmKey>(`/llm-keys/${id}`, json("PATCH", body)),
  remove: (id: string) => apiFetch<void>(`/llm-keys/${id}`, json("DELETE")),
};

