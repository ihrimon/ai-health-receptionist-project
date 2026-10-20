import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPrefetched, prefetch, takeOrFetch } from "./prefetch";

describe("prefetch", () => {
  beforeEach(() => clearPrefetched());

  it("hands the prefetched answer to the first taker without a second request", async () => {
    const start = vi.fn().mockResolvedValue("early");
    prefetch("chatbot", start, 1000);
    const later = vi.fn().mockResolvedValue("late");

    await expect(takeOrFetch("chatbot", later, 2000)).resolves.toBe("early");
    expect(start).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });

  it("is single use: the next request is fresh", async () => {
    prefetch("chatbot", () => Promise.resolve("early"), 1000);
    await takeOrFetch("chatbot", () => Promise.resolve("x"), 1500);

    await expect(
      takeOrFetch("chatbot", () => Promise.resolve("fresh"), 1600),
    ).resolves.toBe("fresh");
  });

  it("ignores an answer that is too old", async () => {
    prefetch("chatbot", () => Promise.resolve("old"), 1000);

    await expect(
      takeOrFetch("chatbot", () => Promise.resolve("fresh"), 1000 + 16_000),
    ).resolves.toBe("fresh");
  });

  it("does not start the same request twice", () => {
    const start = vi.fn().mockResolvedValue(1);
    prefetch("a", start, 1000);
    prefetch("a", start, 1500);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("passes a failure on to the taker", async () => {
    prefetch("a", () => Promise.reject(new Error("401")), 1000);
    await expect(takeOrFetch("a", () => Promise.resolve(1), 1200)).rejects.toThrow(
      "401",
    );
  });

  it("fetches normally when nothing was prefetched", async () => {
    await expect(takeOrFetch("none", () => Promise.resolve("direct"))).resolves.toBe(
      "direct",
    );
  });
});
