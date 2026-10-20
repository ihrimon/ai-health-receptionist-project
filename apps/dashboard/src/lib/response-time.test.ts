import type { AnswerTimings } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  formatMs,
  mainCause,
  speedTone,
  timingBreakdown,
} from "./response-time";

const timings: AnswerTimings = {
  embedMs: 40,
  prepareMs: 210,
  firstTokenMs: 2400,
  llmMs: 8500,
  toolMs: 0,
  totalMs: 9000,
};

describe("formatMs", () => {
  it("reads naturally at every size", () => {
    expect(formatMs(null)).toBe("—");
    expect(formatMs(undefined)).toBe("—");
    expect(formatMs(820)).toBe("820 ms");
    expect(formatMs(2400)).toBe("2.4 s");
    expect(formatMs(72_000)).toBe("1 min 12 s");
  });
});

describe("speedTone", () => {
  it("is fine under 5 s, slow from 5 s, very slow from 10 s", () => {
    expect(speedTone(4999)).toBe("ok");
    expect(speedTone(5000)).toBe("slow");
    expect(speedTone(9999)).toBe("slow");
    expect(speedTone(10_000)).toBe("very-slow");
  });
});

describe("mainCause and timingBreakdown", () => {
  it("names the part that took longest", () => {
    expect(mainCause(timings)).toEqual({
      label: "Waiting for the AI model",
      ms: 8500,
    });
    expect(mainCause({ ...timings, llmMs: 100, prepareMs: 3000 })?.label).toBe(
      "Searching your knowledge",
    );
  });

  it("says nothing for answers without timings or with nothing measured", () => {
    expect(mainCause(null)).toBeNull();
    expect(
      mainCause({ ...timings, embedMs: 0, prepareMs: 0, llmMs: 0, toolMs: 0 }),
    ).toBeNull();
    expect(timingBreakdown(null)).toBe("");
  });

  it("lists the parts biggest first and leaves out empty ones", () => {
    expect(timingBreakdown(timings)).toBe(
      "Waiting for the AI model 8.5 s · Searching your knowledge 210 ms · Understanding the question 40 ms",
    );
  });
});
