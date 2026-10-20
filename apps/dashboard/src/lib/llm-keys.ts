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

export interface ModelOption {
  id: string;
  /** What to expect, shown next to the id. */
  note: string;
}

/**
 * The models offered for each provider, lowest tier first (M7-39): the first
 * one is chosen for the company, so the default is the cheapest and fastest.
 * The list is not exhaustive: "Other model…" takes any id the provider
 * accepts, and the API checks the id with a real call before saving. Model
 * names change, so fix this list when a provider retires one.
 */
export const MODEL_OPTIONS: Record<LlmKeyProvider, ModelOption[]> = {
  gemini: [
    { id: "gemini-3.1-flash-lite", note: "Lowest cost, fastest" },
    { id: "gemini-3.6-flash", note: "Balanced" },
    { id: "gemini-flash-latest", note: "Always the newest Flash" },
    { id: "gemini-3.6-pro", note: "Most capable" },
  ],
  openai: [
    { id: "gpt-4o-mini", note: "Lowest cost, fastest" },
    { id: "gpt-4.1-mini", note: "Balanced" },
    { id: "gpt-4o", note: "More capable" },
    { id: "gpt-4.1", note: "Most capable" },
  ],
  groq: [
    { id: "openai/gpt-oss-20b", note: "Lowest cost, fastest" },
    { id: "llama-3.1-8b-instant", note: "Very fast, small" },
    { id: "llama-3.3-70b-versatile", note: "More capable" },
    { id: "openai/gpt-oss-120b", note: "Most capable" },
  ],
};

/** Just the ids, lowest tier first. */
export const SUGGESTED_MODELS: Record<LlmKeyProvider, string[]> = {
  gemini: MODEL_OPTIONS.gemini.map((m) => m.id),
  openai: MODEL_OPTIONS.openai.map((m) => m.id),
  groq: MODEL_OPTIONS.groq.map((m) => m.id),
};

/** The model chosen for a provider until the company picks another. */
export function defaultModel(provider: LlmKeyProvider): string {
  return MODEL_OPTIONS[provider][0].id;
}

/** Value of the "Other model…" choice in the picker. */
export const CUSTOM_MODEL = "__custom__";

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

