import { describe, expect, it } from "vitest";
import { sourceLabel, uniqueSources } from "./preview-chat";

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
