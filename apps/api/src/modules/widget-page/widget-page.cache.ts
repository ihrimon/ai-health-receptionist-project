import { Injectable } from '@nestjs/common';

/** How long one chatbot's `frame-ancestors` value is reused. */
export const WIDGET_PAGE_TTL_MS = 60_000;
/** Most chatbots kept at once; the oldest entry goes first. */
export const WIDGET_PAGE_MAX_ENTRIES = 5_000;

/** What the widget page needs to know about one live chatbot. */
export interface CachedPage {
  /** The `frame-ancestors` value. */
  ancestors: string;
  allowedDomains: string[];
  /** "Verify installation" is already recorded (M4-14): no write needed. */
  installed: boolean;
}

interface Entry {
  page: CachedPage;
  expiresAt: number;
}

/**
 * In-process cache of each live chatbot's `frame-ancestors` value (and its
 * install status, M4-14) for the widget page (M4-19), so a page load
 * doesn't always query Postgres (no Redis in the MVP). `ChatbotService`
 * drops a chatbot's entry when its allowed domains, status or published
 * version change, so this instance applies a change at once; the short
 * TTL bounds how long another API instance (or a change made outside the
 * API, like a suspended workspace) can serve the old value. Only live
 * chatbots are stored, so requests for random public IDs can't fill it.
 */
@Injectable()
export class WidgetPageCache {
  private readonly entries = new Map<string, Entry>();
  private invalidations = 0;

  /** The clock; tests replace it. */
  now: () => number = () => Date.now();

  /**
   * Read before loading a value and pass it to `set`: a value loaded
   * while an invalidation happened may be the old one, so it isn't kept.
   */
  get generation(): number {
    return this.invalidations;
  }

  get(publicId: string): CachedPage | null {
    const entry = this.entries.get(publicId);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(publicId);
      return null;
    }
    return entry.page;
  }

  set(publicId: string, page: CachedPage, generation: number): void {
    if (generation !== this.invalidations) return;
    this.entries.delete(publicId);
    if (this.entries.size >= WIDGET_PAGE_MAX_ENTRIES) {
      // Maps keep insertion order: the first key is the oldest entry.
      for (const oldest of this.entries.keys()) {
        this.entries.delete(oldest);
        break;
      }
    }
    this.entries.set(publicId, {
      page,
      expiresAt: this.now() + WIDGET_PAGE_TTL_MS,
    });
  }

  /** The install was just recorded, so later loads skip the write. */
  markInstalled(publicId: string): void {
    const entry = this.entries.get(publicId);
    if (entry) entry.page = { ...entry.page, installed: true };
  }

  invalidate(publicId: string): void {
    this.invalidations++;
    this.entries.delete(publicId);
  }

  get size(): number {
    return this.entries.size;
  }
}
