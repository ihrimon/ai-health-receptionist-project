import type { PublicChatConfig } from "@brainstack/shared";
import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { STRINGS } from "./strings";
import { type FakeHandler, type FakeRequest, fakeApi, json, sse, sseResponse } from "./test-utils";

const config: PublicChatConfig = {
  botName: "Acme Bot",
  avatarUrl: null,
  welcomeMessage: "Welcome to Acme!",
  headerTitle: "Acme Support",
  primaryColor: "#facc15",
  position: "right",
  launcherIcon: "chat",
  quickReplies: ["Opening hours"],
  showBranding: false,
};
const storageKey = "brainstack:chat:pub1";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The API with a config, a new conversation per start, and `answer` streamed back. */
function api(overrides: Partial<Record<"history" | "send" | "start" | "rate" | "lead", FakeHandler>> = {}) {
  let started = 0;
  return fakeApi((req: FakeRequest) => {
    if (req.path === "/public/chatbots/pub1/config") return json(config);
    if (req.path === "/public/chatbots/pub1/conversations") {
      started += 1;
      return overrides.start?.(req) ?? json({ conversationId: `c${started}`, conversationToken: `tok${started}` }, 201);
    }
    if (req.method === "GET") return overrides.history?.(req) ?? json([]);
    if (req.path.endsWith("/lead")) return overrides.lead?.(req) ?? new Response(null, { status: 204 });
    if (req.path.endsWith("/rating")) return overrides.rate?.(req) ?? new Response(null, { status: 204 });
    return (
      overrides.send?.(req) ??
      sseResponse([sse("delta", { text: "We open " }), sse("delta", { text: "at 9." }), sse("done", { conversationId: "c1", answeredBy: "llm" })])
    );
  });
}

async function ready(ratingIdleMs?: number) {
  render(<App publicId="pub1" ratingIdleMs={ratingIdleMs} />);
  await screen.findByText(config.welcomeMessage);
  return userEvent.setup();
}

const bubbles = () => [...document.querySelectorAll("[data-role]")].map((el) => [(el as HTMLElement).dataset.role, el.textContent]);
const stored = () => JSON.parse(localStorage.getItem(storageKey) ?? "null");

describe("App: published config (M4-4)", () => {
  it("shows the header title, welcome message and brand color, and hides the branding when asked", async () => {
    api();
    await ready();
    const header = screen.getByRole("heading", { name: "Acme Support" }).parentElement!;
    expect(header.style.background).toBe("rgb(250, 204, 21)");
    // Black text reads better on yellow.
    expect(header.style.color).toBe("rgb(0, 0, 0)");
    expect(screen.queryByRole("link", { name: STRINGS.brandName })).toBeNull();
    expect(document.title).toBe("Acme Bot");
  });

  it("says the chat isn't available for an unknown or switched-off chatbot", async () => {
    fakeApi(() => json({ message: "Not Found" }, 404));
    render(<App publicId="pub1" />);
    expect(screen.getByText(STRINGS.loading)).toBeTruthy();
    expect(await screen.findByText(STRINGS.unavailable)).toBeTruthy();
  });

  it("asks nothing of the API without a chatbot in the URL", () => {
    const { fetchMock } = fakeApi(() => json(config));
    render(<App publicId={null} />);
    expect(screen.getByText(STRINGS.unavailable)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("App: streaming chat (M4-3)", () => {
  it("starts a conversation, streams the answer into one bubble and remembers the conversation", async () => {
    const { requests } = api();
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "When do you open?{Enter}");

    await waitFor(() =>
      expect(bubbles()).toEqual([
        ["assistant", config.welcomeMessage],
        ["user", "When do you open?"],
        ["assistant", "We open at 9."],
      ]),
    );
    const start = requests.find((r) => r.path.endsWith("/conversations"))!;
    expect((start.body as { visitorId: string }).visitorId).toMatch(/^[0-9a-f]{32}$/);
    expect(stored()).toEqual({
      visitorId: (start.body as { visitorId: string }).visitorId,
      conversation: { conversationId: "c1", conversationToken: "tok1" },
    });

    // The next message goes to the same conversation; only its own text is sent.
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "And Sunday?{Enter}");
    await waitFor(() => expect(bubbles()).toHaveLength(5));
    const sends = requests.filter((r) => r.method === "POST" && r.path.endsWith("/messages"));
    expect(sends.map((r) => [r.path, r.headers.Authorization, r.body])).toEqual([
      ["/public/conversations/c1/messages", "Bearer tok1", { message: "When do you open?" }],
      ["/public/conversations/c1/messages", "Bearer tok1", { message: "And Sunday?" }],
    ]);
    expect(requests.filter((r) => r.path.endsWith("/conversations"))).toHaveLength(1);
  });

  it("shows the stored conversation again after a reload", async () => {
    localStorage.setItem(storageKey, JSON.stringify({ visitorId: "v1", conversation: { conversationId: "c9", conversationToken: "tok9" } }));
    const { requests } = api({
      history: () =>
        json([
          { id: "1", role: "user", text: "Earlier question", createdAt: "" },
          { id: "2", role: "assistant", text: "Earlier answer", createdAt: "" },
        ]),
    });
    await ready();
    await waitFor(() => expect(bubbles()).toHaveLength(3));
    expect(bubbles().slice(1)).toEqual([
      ["user", "Earlier question"],
      ["assistant", "Earlier answer"],
    ]);
    expect(requests.find((r) => r.method === "GET" && r.path.endsWith("/messages"))).toMatchObject({
      path: "/public/conversations/c9/messages",
      headers: { Authorization: "Bearer tok9" },
    });
  });

  it("drops an expired conversation and starts a new one for the same visitor", async () => {
    localStorage.setItem(storageKey, JSON.stringify({ visitorId: "v1", conversation: { conversationId: "c9", conversationToken: "old" } }));
    const { requests } = api({ history: () => json({ message: "Unauthorized" }, 401) });
    const user = await ready();
    await waitFor(() => expect(stored()).toEqual({ visitorId: "v1" }));

    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hello{Enter}");
    await screen.findByText("We open at 9.");
    expect(requests.find((r) => r.path.endsWith("/conversations"))?.body).toEqual({ visitorId: "v1" });
    expect(stored()).toEqual({ visitorId: "v1", conversation: { conversationId: "c1", conversationToken: "tok1" } });
  });

  it("removes a half answer when the stream breaks and says so", async () => {
    api({
      send: () => sseResponse([sse("delta", { text: "We open" }), sse("error", { message: "Something went wrong. Please try again." })]),
    });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    await screen.findByText(STRINGS.somethingWrong);
    expect(screen.queryByText("We open")).toBeNull();
  });

  it("asks the visitor to slow down on a rate limit", async () => {
    api({ send: () => json({ message: "Too Many Requests" }, 429) });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    expect(await screen.findByText(STRINGS.tooFast)).toBeTruthy();
  });

  it("asks once more when the server was not reached (a sleeping free-plan server)", async () => {
    let sends = 0;
    api({
      send: () => {
        sends += 1;
        return sends === 1
          ? json({ message: "Bad Gateway" }, 502)
          : sseResponse([sse("delta", { text: "We open at 9." }), sse("done", { conversationId: "c1", answeredBy: "llm" })]);
      },
    });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    expect(await screen.findByText("We open at 9.", {}, { timeout: 3000 })).toBeTruthy();
    expect(sends).toBe(2);
    expect(screen.queryByText(STRINGS.somethingWrong)).toBeNull();
  });

  it("does not send the message again once the answer had started", async () => {
    let sends = 0;
    api({
      send: () => {
        sends += 1;
        return sseResponse([sse("delta", { text: "We open" }), sse("error", { message: "Something went wrong. Please try again." })]);
      },
    });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    await screen.findByText(STRINGS.somethingWrong);
    expect(sends).toBe(1);
  });

  it("holds the next message until the answer is complete", async () => {
    let finish: (() => void) | undefined;
    api({
      send: () => {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(sse("delta", { text: "Partly" })));
              finish = () => controller.close();
            },
          }),
        );
      },
    });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    await screen.findByText("Partly");
    // Streaming: no typing dots any more, but sending waits.
    expect(screen.queryByRole("status")).toBeNull();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "More{Enter}");
    expect(bubbles()).toHaveLength(3);
    finish?.();
    await waitFor(() => expect((screen.getByRole("button", { name: STRINGS.send }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows the streamed Markdown safely, formatted while it streams", async () => {
    api({
      send: () =>
        sseResponse([
          sse("delta", { text: "We have **free " }),
          sse("delta", { text: "delivery** <img src=x onerror=alert(1)> [x](javascript:alert(1))" }),
          sse("done", { conversationId: "c1", answeredBy: "llm" }),
        ]),
    });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Delivery?{Enter}");
    await waitFor(() => expect(document.querySelector("strong")?.textContent).toBe("free delivery"));
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
  });

  it("still chats when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    api();
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hi{Enter}");
    expect(await screen.findByText("We open at 9.")).toBeTruthy();
  });
});

describe("App: contact form (M7-41)", () => {
  const formAnswer = () =>
    sseResponse([
      sse("lead_form", {}),
      sse("delta", { text: "Please fill in the form below." }),
      sse("done", { conversationId: "c1", answeredBy: "llm" }),
    ]);

  it("shows the form under the answer, sends it with the conversation's token, then says thanks", async () => {
    const { requests } = api({ send: formAnswer });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "I want to book a service{Enter}");
    await screen.findByText("Please fill in the form below.");

    await user.type(await screen.findByLabelText(STRINGS.leadForm.name), "Ana");
    await user.type(screen.getByLabelText(STRINGS.leadForm.email), "ana@example.com");
    await user.type(screen.getByLabelText(STRINGS.leadForm.message), "A quote, please");
    await user.click(screen.getByRole("button", { name: STRINGS.leadForm.submit }));

    await screen.findByText(STRINGS.leadForm.thanks);
    const sent = requests.find((r) => r.path === "/public/conversations/c1/lead")!;
    expect(sent.method).toBe("POST");
    expect(sent.headers.Authorization).toBe("Bearer tok1");
    expect(sent.body).toEqual({ name: "Ana", email: "ana@example.com", message: "A quote, please" });
    // The form is gone once the details are in.
    expect(screen.queryByRole("form", { name: STRINGS.leadForm.label })).toBeNull();
  });

  it("shows no form after an ordinary answer", async () => {
    api();
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Opening hours?{Enter}");
    await screen.findByText("We open at 9.");
    expect(screen.queryByRole("form", { name: STRINGS.leadForm.label })).toBeNull();
  });

  it("keeps the form and says so when the API refuses it", async () => {
    api({ send: formAnswer, lead: () => json({ message: "nope" }, 500) });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "I want a quote{Enter}");
    await user.type(await screen.findByLabelText(STRINGS.leadForm.name), "Ana");
    await user.type(screen.getByLabelText(STRINGS.leadForm.phone), "+8801711000000");
    await user.click(screen.getByRole("button", { name: STRINGS.leadForm.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(STRINGS.leadForm.failed));
    expect(screen.getByRole("form", { name: STRINGS.leadForm.label })).toBeTruthy();
  });
});

describe("App: quick replies and handoff (M4-6)", () => {
  it("shows the quick replies with the welcome, sends a picked one and then hides them", async () => {
    const { requests } = api();
    const user = await ready();
    const chips = screen.getByRole("group", { name: STRINGS.quickReplies });
    expect(chips.previousElementSibling?.textContent).toBe(config.welcomeMessage);
    await user.click(screen.getByRole("button", { name: "Opening hours" }));

    await screen.findByText("We open at 9.");
    expect(bubbles()[1]).toEqual(["user", "Opening hours"]);
    expect(requests.find((r) => r.method === "POST" && r.path.endsWith("/messages"))?.body).toEqual({ message: "Opening hours" });
    expect(screen.queryByRole("group", { name: STRINGS.quickReplies })).toBeNull();
    // The clicked chip is gone; the keyboard carries on in the message box (M4-7).
    expect(document.activeElement).toBe(screen.getByLabelText(STRINGS.inputLabel));
  });

  it("shows no quick replies for a conversation picked up after a reload", async () => {
    localStorage.setItem(storageKey, JSON.stringify({ visitorId: "v1", conversation: { conversationId: "c9", conversationToken: "tok9" } }));
    api({ history: () => json([{ id: "1", role: "user", text: "Earlier", createdAt: "" }]) });
    await ready();
    await screen.findByText("Earlier");
    expect(screen.queryByRole("group", { name: STRINGS.quickReplies })).toBeNull();
  });

  it("offers the handoff button after a fallback answer", async () => {
    api({
      send: () =>
        sseResponse([
          sse("delta", { text: "Sorry, I can't help with that." }),
          sse("handoff", { kind: "whatsapp", value: "+8801700000000", label: null }),
          sse("done", { conversationId: "c1", answeredBy: "fallback" }),
        ]),
    });
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Refund?{Enter}");
    const link = await screen.findByRole("link", { name: STRINGS.handoff.whatsapp });
    expect(link.getAttribute("href")).toBe("https://wa.me/8801700000000");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("offers no handoff after a normal answer", async () => {
    api();
    const user = await ready();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    await screen.findByText("We open at 9.");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("App: rating (M5-7)", () => {
  const prompt = () => screen.queryByRole("region", { name: STRINGS.ratingQuestion });
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("asks once the chat is quiet after an answer, and sends the stars with the token", async () => {
    const { requests } = api();
    const user = await ready(10);
    await quiet();
    // Nothing to rate before the bot has answered.
    expect(prompt()).toBeNull();

    await user.type(screen.getByLabelText(STRINGS.inputLabel), "When do you open?{Enter}");
    await screen.findByText("We open at 9.");
    await screen.findByRole("region", { name: STRINGS.ratingQuestion });
    await user.click(screen.getByRole("button", { name: STRINGS.rateStars(4) }));

    expect(await screen.findByText(STRINGS.ratingThanks)).toBeTruthy();
    await waitFor(() =>
      expect(requests.filter((r) => r.path.endsWith("/rating")).map((r) => [r.path, r.headers.Authorization, r.body])).toEqual([
        ["/public/conversations/c1/rating", "Bearer tok1", { rating: 4 }],
      ]),
    );
    expect(stored()).toMatchObject({ rated: "c1" });

    // The thanks goes with the next message, and nobody is asked twice.
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "And Sunday?{Enter}");
    await waitFor(() => expect(bubbles()).toHaveLength(5));
    await quiet();
    expect(screen.queryByText(STRINGS.ratingThanks)).toBeNull();
    expect(prompt()).toBeNull();
  });

  it("doesn't ask again for a conversation rated before a reload", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ visitorId: "v1", conversation: { conversationId: "c9", conversationToken: "tok9" }, rated: "c9" }),
    );
    api({
      history: () =>
        json([
          { id: "1", role: "user", text: "Earlier question", createdAt: "" },
          { id: "2", role: "assistant", text: "Earlier answer", createdAt: "" },
        ]),
    });
    await ready(10);
    await screen.findByText("Earlier answer");
    await quiet();
    expect(prompt()).toBeNull();
  });

  it("asks for a reloaded conversation that has an answer but no rating", async () => {
    localStorage.setItem(storageKey, JSON.stringify({ visitorId: "v1", conversation: { conversationId: "c9", conversationToken: "tok9" } }));
    api({ history: () => json([{ id: "2", role: "assistant", text: "Earlier answer", createdAt: "" }]) });
    await ready(10);
    expect(await screen.findByRole("region", { name: STRINGS.ratingQuestion })).toBeTruthy();
  });

  it("shows the contact follow-up as its own bubble, then asks for the rating once it is answered", async () => {
    let sends = 0;
    api({
      send: () => {
        sends += 1;
        return sends === 1
          ? sseResponse([
              sse("delta", { text: "Fill in the form." }),
              sse("follow_up", { text: "Were you able to reach us?" }),
              sse("done", { conversationId: "c1", answeredBy: "llm" }),
            ])
          : sseResponse([
              sse("delta", { text: "Glad to hear it." }),
              sse("rating_prompt", {}),
              sse("done", { conversationId: "c1", answeredBy: "llm" }),
            ]);
      },
    });
    // A long quiet time: only the server's signal can bring the prompt here.
    const user = await ready(60_000);
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "How do I get in touch?{Enter}");
    await screen.findByText("Were you able to reach us?");
    expect(bubbles().slice(-2)).toEqual([
      ["assistant", "Fill in the form."],
      ["assistant", "Were you able to reach us?"],
    ]);
    expect(prompt()).toBeNull();

    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Yes, done{Enter}");
    await screen.findByText("Glad to hear it.");
    expect(await screen.findByRole("region", { name: STRINGS.ratingQuestion })).toBeTruthy();
  });

  it("'Skip for now' hides it without sending anything", async () => {
    const { requests } = api();
    const user = await ready(10);
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    await screen.findByRole("region", { name: STRINGS.ratingQuestion });
    await user.click(screen.getByRole("button", { name: STRINGS.ratingSkip }));
    expect(prompt()).toBeNull();
    expect(requests.some((r) => r.path.endsWith("/rating"))).toBe(false);
  });

  it("still thanks the visitor when the rating can't be saved", async () => {
    api({ rate: () => json({ message: "Too Many Requests" }, 429) });
    const user = await ready(10);
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hours?{Enter}");
    await screen.findByRole("region", { name: STRINGS.ratingQuestion });
    await user.click(screen.getByRole("button", { name: STRINGS.rateStars(2) }));
    expect(await screen.findByText(STRINGS.ratingThanks)).toBeTruthy();
    // No error note in the chat either.
    expect(bubbles().at(-1)).toEqual(["assistant", "We open at 9."]);
  });
});
