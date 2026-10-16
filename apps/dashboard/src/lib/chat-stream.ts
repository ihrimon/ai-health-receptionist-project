import type { ChatStreamEvent } from "@brainstack/shared";
import { API_BASE, API_HEADERS, ApiError } from "@/lib/api";

/**
 * Splits the text read so far into whole Server-Sent Events and what is
 * left over (an event cut in the middle). Events are separated by a blank
 * line; each has `event:` and `data:` lines (D-2 §3.2).
 */
export function parseSseEvents(buffer: string): {
  events: ChatStreamEvent[];
  rest: string;
} {
  const events: ChatStreamEvent[] = [];
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let type = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!type) continue;
    try {
      const payload = data ? (JSON.parse(data) as object) : {};
      events.push({ type, ...payload } as ChatStreamEvent);
    } catch {
      // A broken event is skipped; the stream goes on.
    }
  }
  return { events, rest };
}

/**
 * POSTs a chat message and calls `onEvent` for each event as it arrives.
 * Resolves when the stream ends; an HTTP error before it starts (a 404, a
 * 429) throws ApiError like apiFetch.
 */
export async function postChatStream(
  path: string,
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { ...API_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    const message =
      (Array.isArray(error?.message)
        ? error.message.join(", ")
        : error?.message) ?? `API returned ${res.status}`;
    throw new ApiError(message, res.status);
  }
  if (!res.body) throw new ApiError("The chat gave no answer", res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseEvents(buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}
