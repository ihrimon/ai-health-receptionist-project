import { Injectable, Logger } from '@nestjs/common';
import type { LlmCredential, LlmProvider } from '../../generated/prisma/client';
import { LlmCredentialsService } from '../llm-credentials/llm-credentials.service';

/** Thrown when no LLM credential has been configured yet (Settings page is empty). */
export class NoLlmCredentialsConfiguredError extends Error {
  constructor() {
    super('No LLM API key has been configured in Settings yet.');
    this.name = 'NoLlmCredentialsConfiguredError';
  }
}

/** Thrown by LlmChatClient when every configured credential has been rate-limited. */
export class AllLlmKeysExhaustedError extends Error {
  constructor() {
    super('All configured LLM API keys are currently rate-limited.');
    this.name = 'AllLlmKeysExhaustedError';
  }
}

export interface LlmCredentialSnapshot {
  id: string;
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

/**
 * Minimal structural shape of a Fetch-style Headers object — just what
 * recordUsage() needs. Avoids depending on the DOM lib's `Headers` type
 * directly, since groq-sdk's own Headers type (from its Node shims)
 * isn't structurally identical to it despite both having a `.get()`.
 */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Tracks which of the admin-configured LLM credentials (Settings page,
 * backed by LlmCredentialsService — no more .env GROQ_API_KEY) is
 * currently active, and advances forward through them in sort_order when
 * one gets rate-limited, so a caller (LlmChatClient) can keep retrying a
 * single request across keys without the user ever seeing a raw
 * rate-limit error. Each credential carries its own `model`, so this
 * also transparently rotates across different providers/models, not
 * just multiple keys for the same one.
 *
 * The credential list is re-fetched from the database on every call
 * (cheap at this project's scale) rather than cached, so an admin
 * editing Settings takes effect on the very next chat turn without a
 * restart.
 *
 * Position is tracked by credential ID, not list index — an index would
 * silently point at a *different* credential the moment an admin
 * reorders the list (same slot, different key now sitting in it), and
 * point PAST THE END the moment they delete the in-rotation credential,
 * which made getCurrentCredential() return undefined and every chat
 * turn fail immediately even with other perfectly good keys still
 * configured (confirmed live: deleting the active key broke chat
 * entirely). Tracking by ID means a reorder simply doesn't affect which
 * real credential is "active", and a delete falls back to whatever is
 * now first in the list instead of falling off the end.
 *
 * Single NestJS process, in-memory state: fine for this project's one-
 * `api`-container deployment; a multi-instance deployment would need
 * this state moved somewhere shared (e.g. Redis) to rotate in sync
 * across instances. Rotation is forward-only for the lifetime of the
 * process — once the last credential is exhausted, every further
 * request gets the "all keys exhausted" fallback until the process
 * restarts (or an admin edits Settings, since the list is re-read live
 * on every call).
 */
@Injectable()
export class LlmKeyManager {
  private readonly logger = new Logger(LlmKeyManager.name);
  private currentCredentialId: string | null = null;

  constructor(private readonly credentialsService: LlmCredentialsService) {}

  async getCurrentCredential(): Promise<LlmCredentialSnapshot | undefined> {
    const credentials = await this.credentialsService.findActiveOrdered();
    if (credentials.length === 0) {
      this.currentCredentialId = null;
      return undefined;
    }
    // Falls back to the first credential in the list whenever the one we
    // were last pointed at is gone (deleted, paused, or never set yet) —
    // see the class doc comment for why this can't just be an index.
    const current =
      credentials.find((c) => c.id === this.currentCredentialId) ??
      credentials[0];
    this.currentCredentialId = current.id;
    return toSnapshot(current);
  }

  async getCredentialCount(): Promise<number> {
    return (await this.credentialsService.findActiveOrdered()).length;
  }

  /**
   * Advances to the next credential after the current one, by position
   * in the live list. Returns true if there was a next one to move to,
   * false if the caller was already on the last one.
   *
   * A credential that's since vanished (deleted or paused) is treated as
   * index -1 — "next" becomes index 0, the same first-in-list fallback
   * getCurrentCredential() would have picked anyway — but `null` (never
   * pointed at anything yet) is treated as already AT index 0, so the
   * very first rotateToNext() call on a fresh manager correctly advances
   * to index 1 rather than re-selecting index 0 it was implicitly
   * already "on".
   */
  async rotateToNext(): Promise<boolean> {
    const credentials = await this.credentialsService.findActiveOrdered();
    const total = credentials.length;
    if (total === 0) {
      this.currentCredentialId = null;
      return false;
    }
    const currentIndex =
      this.currentCredentialId === null
        ? 0
        : credentials.findIndex((c) => c.id === this.currentCredentialId);
    const nextIndex = currentIndex + 1;
    if (nextIndex >= total) {
      this.logger.warn(
        `LLM credential ${currentIndex + 1}/${total} unavailable — no more credentials to rotate to. (See the "Credential ... failed" line just above for the actual reason.)`,
      );
      return false;
    }
    this.currentCredentialId = credentials[nextIndex].id;
    this.logger.warn(
      `LLM credential ${currentIndex + 1}/${total} unavailable — rotating to credential ${nextIndex + 1}/${total}. (See the "Credential ... failed" line just above for the actual reason.)`,
    );
    return true;
  }

  /**
   * Reads the provider's OpenAI-compatible x-ratelimit-* response headers
   * (present on both successful and 429 responses) and persists a
   * snapshot against that credential, so the Settings page can show how
   * close each key is to its limit. Called from LlmChatClient after every
   * real API call — best-effort: a failure here is logged and swallowed,
   * never allowed to fail the chat turn itself.
   */
  async recordUsage(id: string, headers?: HeaderReader): Promise<void> {
    try {
      await this.credentialsService.recordUsage(id, {
        rlLimitRequests: headers
          ? readIntHeader(headers, 'x-ratelimit-limit-requests')
          : undefined,
        rlRemainingRequests: headers
          ? readIntHeader(headers, 'x-ratelimit-remaining-requests')
          : undefined,
        rlResetRequests:
          headers?.get('x-ratelimit-reset-requests') ?? undefined,
        rlLimitTokens: headers
          ? readIntHeader(headers, 'x-ratelimit-limit-tokens')
          : undefined,
        rlRemainingTokens: headers
          ? readIntHeader(headers, 'x-ratelimit-remaining-tokens')
          : undefined,
        rlResetTokens: headers?.get('x-ratelimit-reset-tokens') ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record usage snapshot for credential ${id}: ${(err as Error).message}`,
      );
    }
  }
}

function readIntHeader(
  headers: HeaderReader,
  name: string,
): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toSnapshot(credential: LlmCredential): LlmCredentialSnapshot {
  return {
    id: credential.id,
    provider: credential.provider,
    apiKey: credential.apiKey,
    model: credential.model,
  };
}
