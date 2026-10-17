import type { AnalyticsDay } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  addToKnowledgeHref,
  chartMax,
  formatMetric,
  formatRate,
  metricValue,
  overviewQueryString,
  prefillQuestion,
  shortDay,
} from "./analytics";

const day: AnalyticsDay = {
  date: "2026-10-17",
  conversations: 3,
  messages: 12,
  leads: 1,
  avgRating: null,
  ratings: 0,
};

describe("overviewQueryString", () => {
  it("asks for the last N UTC days, today included", () => {
    const now = new Date("2026-10-17T23:30:00Z");
    expect(overviewQueryString(7, now)).toBe("?from=2026-10-11&to=2026-10-17");
    expect(overviewQueryString(30, now)).toBe("?from=2026-09-18&to=2026-10-17");
  });
});

describe("addToKnowledgeHref / prefillQuestion", () => {
  it("round-trips a question, Bangla and symbols included", () => {
    for (const q of ["Do you ship to Dhaka & Chattogram?", "আপনাদের ঠিকানা কী?"]) {
      const href = addToKnowledgeHref(q);
      expect(href.startsWith("/app/knowledge?addFaq=")).toBe(true);
      expect(prefillQuestion(href.slice(href.indexOf("?")))).toBe(q);
    }
  });

  it("ignores a missing or blank value and cuts to the 500-character limit", () => {
    expect(prefillQuestion("")).toBeNull();
    expect(prefillQuestion("?addFaq=%20%20")).toBeNull();
    expect(prefillQuestion("?other=1")).toBeNull();
    expect(prefillQuestion(`?addFaq=${"a".repeat(600)}`)).toHaveLength(500);
  });
});

describe("chartMax", () => {
  it("rounds the scale up to 1, 2 or 5 × 10ⁿ", () => {
    expect(chartMax([0, 0], "conversations")).toBe(1);
    expect(chartMax([1], "leads")).toBe(1);
    expect(chartMax([3, null], "messages")).toBe(5);
    expect(chartMax([12], "messages")).toBe(20);
    expect(chartMax([50], "messages")).toBe(50);
    expect(chartMax([51], "messages")).toBe(100);
  });

  it("uses the full 5-star scale for ratings", () => {
    expect(chartMax([2.5, null], "avgRating")).toBe(5);
  });
});

describe("formatting", () => {
  it("reads values per metric", () => {
    expect(metricValue(day, "messages")).toBe(12);
    expect(metricValue(day, "avgRating")).toBeNull();
    expect(formatMetric(4.5, "avgRating")).toBe("4.5");
    expect(formatMetric(1234, "messages")).toBe("1,234");
    expect(formatMetric(null, "avgRating")).toBe("—");
    expect(formatRate(0.333)).toBe("33%");
    expect(formatRate(null)).toBeNull();
  });

  it("names a UTC day without shifting it", () => {
    expect(shortDay("2026-10-01")).toBe("Oct 1");
  });
});
