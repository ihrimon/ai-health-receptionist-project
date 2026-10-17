import { describe, expect, it } from "vitest";
import { envelope, readHostMessage, readWidgetMessage } from "./protocol";

const wrap = (fields: Record<string, unknown>) => ({ ns: "brainstack", v: 1, ...fields });

describe("protocol v1 (M4-10)", () => {
  it("wraps a message with the namespace and version", () => {
    expect(envelope({ type: "close" })).toEqual({ ns: "brainstack", v: 1, type: "close" });
  });

  it("reads every chat window message with valid fields", () => {
    for (const type of ["ready", "open", "close"]) expect(readWidgetMessage(wrap({ type }))).toEqual({ type });
    const config = { type: "config", primaryColor: "#0F766E", textColor: "#ffffff", position: "left", launcherIcon: "help" };
    expect(readWidgetMessage(wrap(config))).toEqual(config);
    expect(readWidgetMessage(wrap({ type: "resize", width: 400, height: 600 }))).toEqual({
      type: "resize",
      width: 400,
      height: 600,
    });
    expect(readWidgetMessage(wrap({ type: "unread", count: 2 }))).toEqual({ type: "unread", count: 2 });
  });

  it("reads a missing or unknown launcher icon as the default, so other versions still work", () => {
    const base = { type: "config", primaryColor: "#0F766E", textColor: "#ffffff", position: "right" };
    expect(readWidgetMessage(wrap(base))).toEqual({ ...base, launcherIcon: "chat" });
    expect(readWidgetMessage(wrap({ ...base, launcherIcon: "<svg onload=x>" }))).toEqual({ ...base, launcherIcon: "chat" });
    expect(readWidgetMessage(wrap({ ...base, launcherIcon: "custom" }))).toEqual({ ...base, launcherIcon: "chat" });
  });

  it("drops extra fields, so nothing unexpected reaches the page", () => {
    expect(readWidgetMessage(wrap({ type: "close", html: "<img onerror=x>" }))).toEqual({ type: "close" });
  });

  it("rejects other namespaces, versions, unknown types and bad fields", () => {
    const bad: unknown[] = [
      null,
      "brainstack:close",
      { type: "close" },
      { ns: "other", v: 1, type: "close" },
      wrap({ v: 2, type: "close" }),
      wrap({ type: "explode" }),
      wrap({ type: "config", primaryColor: "red;background:url(x)", textColor: "#ffffff", position: "right" }),
      wrap({ type: "config", primaryColor: "#0F766E", textColor: "#123456", position: "right" }),
      wrap({ type: "config", primaryColor: "#0F766E", textColor: "#ffffff", position: "top" }),
      wrap({ type: "resize", width: "400", height: 600 }),
      wrap({ type: "resize", width: Number.POSITIVE_INFINITY, height: 600 }),
      wrap({ type: "unread", count: -1 }),
      wrap({ type: "unread", count: 1.5 }),
    ];
    for (const data of bad) expect(readWidgetMessage(data)).toBeNull();
  });

  it("reads the loader's init and state, and nothing else", () => {
    expect(readHostMessage(wrap({ type: "init", open: false }))).toEqual({ type: "init", open: false });
    expect(readHostMessage(wrap({ type: "state", open: true }))).toEqual({ type: "state", open: true });
    expect(readHostMessage(wrap({ type: "state", open: "yes" }))).toBeNull();
    expect(readHostMessage(wrap({ type: "close", open: true }))).toBeNull();
    expect(readHostMessage({ type: "init", open: true })).toBeNull();
  });
});
