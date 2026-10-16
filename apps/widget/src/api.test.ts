import type { ChatStreamEvent } from "@brainstack/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, parseSseEvents, readSse, widgetApi } from "./api";
import { fakeApi, json, sse, sseResponse } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

const chat = { conversationId: "c1", conversationToken: "tok" };

describe("parseSseEvents", () => {
  it("returns whole events and keeps a cut-off one for later", () => {
    const { events, rest } = parseSseEvents(
      `${sse("delta", { text: "Hi" })}${sse("done", { conversationId: "c1", answeredBy: "llm" })}event: del`,
    );
    expect(events).toEqual([
      { type: "delta", text: "Hi" },
      { type: "done", conversationId: "c1", answeredBy: "llm" },
    ]);
    expect(rest).toBe("event: del");
  });

  it("reads CRLF line ends and skips broken or nameless events", () => {
    const { events } = parseSseEvents(
      'event: delta\r\ndata: {"text":"a"}\r\n\r\nevent: delta\ndata: {oops\n\ndata: {"text":"b"}\n\n',
    );
    expect(events).toEqual([{ type: "delta", text: "a" }]);
  });
});

describe("readSse", () => {
  it("joins events split across chunks, including a last one without its blank line", async () => {
    const seen: ChatStreamEvent[] = [];
    await readSse(
      sseResponse(['event: delta\ndata: {"te', 'xt":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n']).body!,
      (e) => seen.push(e),
    );
    expect(seen).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
    ]);
  });
});

describe("widgetApi", () => {
  it("sends a message with the token and the CSRF header, without cookies", async () => {
    const { requests, fetchMock } = fakeApi(() => sseResponse([sse("delta", { text: "Yes" })]));
    const seen: ChatStreamEvent[] = [];
    await widgetApi.send(chat, "Open today?", (e) => seen.push(e));
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/public/conversations/c1/messages",
      headers: { Authorization: "Bearer tok", "X-Requested-With": "fetch" },
      body: { message: "Open today?" },
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
    expect(seen).toEqual([{ type: "delta", text: "Yes" }]);
  });

  it("loads the config with a plain GET (no preflight)", async () => {
    const { requests } = fakeApi(() => json({ botName: "Acme" }));
    await widgetApi.config("pub 1");
    expect(requests[0]).toMatchObject({ method: "GET", path: "/public/chatbots/pub%201/config", headers: {} });
  });

  it("throws the HTTP status, or 0 when the API can't be reached", async () => {
    fakeApi(() => json({ message: "Too many requests" }, 429));
    await expect(widgetApi.send(chat, "Hi", () => {})).rejects.toMatchObject({
      status: 429,
      message: "Too many requests",
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await widgetApi.config("pub").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });
});
