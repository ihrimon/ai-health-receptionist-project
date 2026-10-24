import {
  createTextSourceSchema,
  DOCUMENT_MAX_BYTES,
  KNOWLEDGE_LIMITS,
} from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  checkUpload,
  filterFaqs,
  formatBytes,
  limitInfo,
  moveItem,
  needsPolling,
  pollDelay,
  statusSignature,
  POLICY_TEMPLATES,
  statusBadge,
} from "./knowledge";

describe("moveItem", () => {
  it("swaps with the neighbour", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the list alone at the ends", () => {
    const items = ["a", "b"];
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });
});

describe("filterFaqs", () => {
  const faqs = [
    { id: "1", question: "Do you ship abroad?", answer: "No.", sortOrder: 0 },
    { id: "2", question: "Hours?", answer: "We open at 10am.", sortOrder: 1 },
  ];

  it("matches question or answer, ignoring case", () => {
    expect(filterFaqs(faqs, "SHIP").map((f) => f.id)).toEqual(["1"]);
    expect(filterFaqs(faqs, "10am").map((f) => f.id)).toEqual(["2"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterFaqs(faqs, "  ")).toBe(faqs);
  });
});

describe("limitInfo", () => {
  it("shows the count and whether another fits", () => {
    expect(limitInfo(12, 25)).toEqual({ label: "12 / 25", full: false });
    expect(limitInfo(25, 25).full).toBe(true);
  });
});

describe("checkUpload", () => {
  const file = (name: string, size = 1000) => ({ name, size });

  it("accepts the supported types", () => {
    for (const name of ["a.pdf", "b.DOCX", "c.txt", "d.md"]) {
      expect(checkUpload(file(name), 0)).toBeNull();
    }
  });

  it("explains what's wrong", () => {
    expect(checkUpload(file("photo.png"), 0)).toMatch(/isn't a PDF/);
    expect(checkUpload(file("big.pdf", DOCUMENT_MAX_BYTES + 1), 0)).toMatch(
      /larger than 10 MB/,
    );
    expect(checkUpload(file("empty.txt", 0), 0)).toMatch(/is empty/);
    expect(checkUpload(file("a.pdf"), KNOWLEDGE_LIMITS.documents)).toMatch(
      /at most 20 documents/,
    );
  });
});

describe("statusBadge and needsPolling", () => {
  it("labels each status", () => {
    expect(statusBadge("QUEUED")).toEqual({ label: "Processing…", tone: "busy" });
    expect(statusBadge("PROCESSING").tone).toBe("busy");
    expect(statusBadge("READY")).toEqual({ label: "Ready", tone: "ok" });
    expect(statusBadge("FAILED").tone).toBe("error");
  });

  it("polls while anything is still being indexed", () => {
    expect(needsPolling([{ status: "READY" }, { status: "QUEUED" }])).toBe(
      true,
    );
    expect(needsPolling([{ status: "PROCESSING" }])).toBe(true);
    expect(needsPolling([{ status: "READY" }, { status: "FAILED" }])).toBe(
      false,
    );
  });
});

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("POLICY_TEMPLATES", () => {
  it("are valid policy pages for the API", () => {
    for (const template of POLICY_TEMPLATES) {
      const result = createTextSourceSchema.safeParse({
        type: "POLICY",
        title: template.title,
        content: template.content,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("pollDelay and statusSignature (M7-38)", () => {
  it("starts at 3 seconds, grows while nothing changes, and stops at 15", () => {
    expect(pollDelay(0)).toBe(3000);
    expect(pollDelay(1)).toBe(4500);
    expect(pollDelay(2)).toBeGreaterThan(pollDelay(1));
    expect(pollDelay(20)).toBe(15_000);
  });

  it("changes when any source changes state, and only then", () => {
    const a = [
      { id: "1", status: "QUEUED" as const },
      { id: "2", status: "READY" as const },
    ];
    expect(statusSignature(a)).toBe(statusSignature([...a]));
    expect(statusSignature(a)).not.toBe(
      statusSignature([{ id: "1", status: "READY" as const }, a[1]]),
    );
  });
});
