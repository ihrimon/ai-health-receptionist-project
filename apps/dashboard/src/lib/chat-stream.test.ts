import { describe, expect, it } from "vitest";
import { parseSseEvents } from "./chat-stream";

describe("parseSseEvents", () => {
  it("reads whole events and keeps an unfinished one for later", () => {
    const text =
      'event: delta\ndata: {"text":"Hel"}\n\n' +
      'event: delta\ndata: {"text":"lo"}\n\n' +
      'event: done\ndata: {"conversationId":"c1","answeredBy":"llm"}\n\n' +
      'event: delta\ndata: {"te';

    const { events, rest } = parseSseEvents(text);

    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "done", conversationId: "c1", answeredBy: "llm" },
    ]);
    expect(rest).toBe('event: delta\ndata: {"te');
  });

  it("completes an event that arrives in two pieces", () => {
    const first = parseSseEvents('event: delta\ndata: {"text":"Hi"}\n');
    expect(first.events).toEqual([]);

    const second = parseSseEvents(`${first.rest}\n`);
    expect(second.events).toEqual([{ type: "delta", text: "Hi" }]);
  });

  it("skips a broken event and understands CRLF line ends", () => {
    const { events } = parseSseEvents(
      "event: delta\r\ndata: {oops\r\n\r\n" +
        'event: error\r\ndata: {"message":"nope"}\r\n\r\n',
    );
    expect(events).toEqual([{ type: "error", message: "nope" }]);
  });
});
