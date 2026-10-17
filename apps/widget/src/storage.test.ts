import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStored, newVisitorId, saveStored } from "./storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const conversation = { conversationId: "c1", conversationToken: "tok" };

describe("widget storage", () => {
  it("keeps the visitor and conversation per chatbot", () => {
    saveStored("bot-a", { visitorId: "v1", conversation });
    expect(loadStored("bot-a")).toEqual({ visitorId: "v1", conversation });
    expect(loadStored("bot-b")).toEqual({});
  });

  it("remembers which conversation was rated (M5-7)", () => {
    saveStored("bot-a", { visitorId: "v1", conversation, rated: "c1" });
    expect(loadStored("bot-a").rated).toBe("c1");
    localStorage.setItem("brainstack:chat:bot-a", JSON.stringify({ visitorId: "v1", rated: 7 }));
    expect(loadStored("bot-a")).toEqual({ visitorId: "v1" });
  });

  it("ignores broken or half-written data", () => {
    localStorage.setItem("brainstack:chat:bot-a", "{not json");
    expect(loadStored("bot-a")).toEqual({});
    localStorage.setItem(
      "brainstack:chat:bot-a",
      JSON.stringify({ visitorId: 5, conversation: { conversationId: "c1" } }),
    );
    expect(loadStored("bot-a")).toEqual({});
  });

  it("works without storage (blocked or full)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => saveStored("bot-a", { visitorId: "v1" })).not.toThrow();
    expect(loadStored("bot-a")).toEqual({});
  });
});

describe("newVisitorId", () => {
  it("is 32 random hex characters, which the API accepts", () => {
    const id = newVisitorId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(newVisitorId()).not.toBe(id);
  });
});
