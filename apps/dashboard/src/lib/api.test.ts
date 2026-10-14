import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "./api";

const headersOf = (mock: ReturnType<typeof vi.fn>) =>
  (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

describe("apiFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends JSON with the CSRF header and the session cookie", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetch);

    await expect(
      apiFetch("/faqs", { method: "POST", body: "{}" }),
    ).resolves.toEqual({ ok: true });

    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/faqs$/);
    expect((fetch.mock.calls[0][1] as RequestInit).credentials).toBe("include");
    expect(headersOf(fetch)).toMatchObject({
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
    });
  });

  it("leaves Content-Type to the browser for a file upload", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);

    await apiFetch("/knowledge-sources/upload", {
      method: "POST",
      body: new FormData(),
    });

    expect(headersOf(fetch)["Content-Type"]).toBeUndefined();
    expect(headersOf(fetch)["X-Requested-With"]).toBe("fetch");
  });

  it("throws the API's message with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"message":"A chatbot can have at most 25 FAQs"}', {
          status: 409,
        }),
      ),
    );

    const error = await apiFetch("/faqs").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "A chatbot can have at most 25 FAQs",
    });
  });
});
