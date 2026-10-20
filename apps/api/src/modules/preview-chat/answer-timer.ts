import type { AnswerTimings } from '@brainstack/shared';

type Part = 'embedMs' | 'prepareMs' | 'llmMs' | 'toolMs';

/**
 * Measures where the time of one answer goes (M7-40), so a slow question
 * can be traced to its cause: the embedding, the database search, the AI
 * model or a tool. One timer per answer; `now` is replaceable for tests.
 */
export class AnswerTimer {
  private readonly startedAt: number;
  private readonly parts: Record<Part, number> = {
    embedMs: 0,
    prepareMs: 0,
    llmMs: 0,
    toolMs: 0,
  };
  private firstTokenAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  /** Milliseconds since the visitor's message arrived. */
  elapsed(): number {
    return this.now() - this.startedAt;
  }

  /** Starts timing a part; call the returned function when it ends. Parts add up. */
  begin(part: Part): () => void {
    const from = this.now();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.parts[part] += this.now() - from;
    };
  }

  /** Runs and times one step. */
  async measure<T>(part: Part, work: () => Promise<T>): Promise<T> {
    const end = this.begin(part);
    try {
      return await work();
    } finally {
      end();
    }
  }

  /** The first words of the answer reached the visitor; only the first call counts. */
  firstToken(): void {
    this.firstTokenAt ??= this.elapsed();
  }

  snapshot(): AnswerTimings {
    return {
      ...this.parts,
      firstTokenMs: this.firstTokenAt,
      totalMs: this.elapsed(),
    };
  }
}
