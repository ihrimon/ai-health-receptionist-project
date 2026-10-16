import { vi } from "vitest";
import type { HostWindow } from "./host";

/**
 * A framed window for tests: the parent records what the chat window
 * posts, and `deliver` plays a message to it as if from `source`.
 */
export function fakeHostWindow(ancestorOrigins?: string[]) {
  const parent = { postMessage: vi.fn() };
  const listeners = new Set<(event: MessageEvent) => void>();
  const win = {
    parent,
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
    location: { ancestorOrigins },
  } as unknown as HostWindow;
  const deliver = (data: unknown, origin: string, source: unknown = parent) =>
    listeners.forEach((fn) => fn({ data, origin, source } as MessageEvent));
  /** The messages posted so far, with their target origin. */
  const posted = () =>
    parent.postMessage.mock.calls.map(([data, target]) => ({ data: data as Record<string, unknown>, target }));
  return { win, parent, deliver, posted, listeners };
}

export const hostMessage = (type: "init" | "state", open: boolean) => ({ ns: "brainstack", v: 1, type, open });
