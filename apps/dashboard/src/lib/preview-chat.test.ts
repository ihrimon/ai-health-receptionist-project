import { PREVIEW_CHAT_LIMITS } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  historyFor,
  type PreviewMessage,
  sourceLabel,
  uniqueSources,
} from "./preview-chat";

describe("historyFor", () => {
  it("drops sources and keeps only the most recent turns", () => {
    const messages: PreviewMessage[] = Array.from(
      { length: PREVIEW_CHAT_LIMITS.historyTurns + 3 },
      (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        text: `m${i}`,
        sources: [],
      }),
    );
    const history = historyFor(messages);
    expect(history).toHaveLength(PREVIEW_CHAT_LIMITS.historyTurns);
    expect(history[0]).toEqual({ role: "assistant", text: "m3" });
    expect(history.at(-1)?.text).toBe(`m${messages.length - 1}`);
  });
});

describe("sources", () => {
  it("shows the page when there is one", () => {
    expect(sourceLabel({ title: "Guide", page: 2, similarity: 0.7 })).toBe(
      "Guide (p. 2)",
    );
    expect(sourceLabel({ title: "FAQ", page: null, similarity: 0.7 })).toBe(
      "FAQ",
    );
  });

  it("lists each source once, in ranked order", () => {
    expect(
      uniqueSources([
        { title: "B", page: null, similarity: 0.9 },
        { title: "A", page: 1, similarity: 0.8 },
        { title: "B", page: null, similarity: 0.7 },
      ]),
    ).toEqual(["B", "A (p. 1)"]);
  });
});
