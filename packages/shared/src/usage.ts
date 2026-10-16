/** GET /v1/usage (D-2 §2.6): this month's chat use of the workspace. */
export interface UsageView {
  /** Calendar month, UTC: "2026-10". */
  period: string;
  /** Answers to live visitors. */
  messages: number;
  /** Answers in the dashboard Test chat; not counted against any limit. */
  previewMessages: number;
  tokensIn: number;
  tokensOut: number;
  /** The plan's monthly message limit; null until plans exist (M6/M7). */
  limit: number | null;
}
