import type { HostToWidgetMessage, WidgetEnvelope, WidgetToHostMessage } from "@brainstack/shared";

/*
 * The runtime half of the loader ↔ chat window protocol (M4-10; the types
 * and the rules are in @brainstack/shared `widget-protocol.ts`). Shared by
 * the loader and the widget, with no dependencies, so it stays a few
 * hundred bytes in each bundle.
 */

/** Same values as `WIDGET_PROTOCOL_NS` / `WIDGET_PROTOCOL_VERSION` in @brainstack/shared (types only here). */
const NS = "brainstack";
const VERSION = 1;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function envelope<T extends { type: string }>(message: T): WidgetEnvelope<T> {
  return { ns: NS, v: VERSION, ...message };
}

type Raw = Record<string, unknown>;

/** The fields of a message of this protocol and version, or null. */
function unwrap(data: unknown): Raw | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Raw;
  return raw.ns === NS && raw.v === VERSION && typeof raw.type === "string" ? raw : null;
}

const isSize = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** A message from the chat window, checked field by field; anything else is null. */
export function readWidgetMessage(data: unknown): WidgetToHostMessage | null {
  const raw = unwrap(data);
  if (!raw) return null;
  switch (raw.type) {
    case "ready":
    case "open":
    case "close":
      return { type: raw.type };
    case "config":
      if (
        typeof raw.primaryColor !== "string" ||
        !HEX_COLOR.test(raw.primaryColor) ||
        (raw.textColor !== "#000000" && raw.textColor !== "#ffffff") ||
        (raw.position !== "left" && raw.position !== "right")
      ) {
        return null;
      }
      return {
        type: "config",
        primaryColor: raw.primaryColor,
        textColor: raw.textColor,
        position: raw.position,
      };
    case "resize":
      return isSize(raw.width) && isSize(raw.height)
        ? { type: "resize", width: raw.width, height: raw.height }
        : null;
    case "unread":
      return Number.isInteger(raw.count) && (raw.count as number) >= 0
        ? { type: "unread", count: raw.count as number }
        : null;
    default:
      return null;
  }
}

/** A message from the loader, checked field by field; anything else is null. */
export function readHostMessage(data: unknown): HostToWidgetMessage | null {
  const raw = unwrap(data);
  if (!raw || typeof raw.open !== "boolean") return null;
  return raw.type === "init" || raw.type === "state" ? { type: raw.type, open: raw.open } : null;
}
