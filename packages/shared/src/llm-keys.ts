import { z } from 'zod';
import { text } from './text';

/**
 * A workspace's own LLM API keys (M3-21): the owner adds them in
 * Settings → AI and chat runs on them. The API never returns a key, only
 * its last 4 characters.
 */

/** Providers a workspace can bring a key for (lead's call, 2026-10-15). */
export const LLM_KEY_PROVIDERS = ['openai', 'gemini', 'groq'] as const;
export type LlmKeyProvider = (typeof LLM_KEY_PROVIDERS)[number];

export const LLM_KEY_LIMITS = {
  /** Keys per workspace; chat tries them oldest first. */
  maxKeys: 5,
} as const;

// Keys have no spaces; one pasted with a line break or space is a typo.
const apiKey = z
  .string()
  .trim()
  .min(8)
  .max(500)
  .regex(/^\S+$/, { message: 'Must not contain spaces' });

const model = text(1, 100);

export const createLlmKeySchema = z.strictObject({
  provider: z.enum(LLM_KEY_PROVIDERS),
  model,
  apiKey,
});

/** The provider stays fixed: a new provider means a new key. */
export const updateLlmKeySchema = z
  .strictObject({ model, apiKey, isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

export type CreateLlmKey = z.output<typeof createLlmKeySchema>;
export type UpdateLlmKey = z.output<typeof updateLlmKeySchema>;

/** GET /v1/llm-keys row. */
export interface LlmKeyView {
  id: string;
  provider: LlmKeyProvider;
  model: string;
  keyLast4: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}
