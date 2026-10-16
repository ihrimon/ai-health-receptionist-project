import { vi } from "vitest";

/* A fake public chat API for the tests: `fetch` is replaced by a handler
   that sees the method, the path after `/v1` and the request. */

export interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FakeHandler = (req: FakeRequest) => Response | Promise<Response>;

export function fakeApi(handler: FakeHandler) {
  const requests: FakeRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const req: FakeRequest = {
      method: init.method ?? "GET",
      path: url.pathname.replace(/^\/v1/, ""),
      headers: (init.headers as Record<string, string> | undefined) ?? {},
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    return handler(req);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** One SSE event as the API writes it (`common/sse.ts`). */
export const sse = (type: string, data: object = {}) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/** A streamed response that sends `chunks` one by one. */
export function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
