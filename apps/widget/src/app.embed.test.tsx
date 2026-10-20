import type { PublicChatConfig } from "@brainstack/shared";
import { act, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { STRINGS } from "./strings";
import { fakeHostWindow, hostMessage } from "./test-host";
import { fakeApi, json, sse, sseResponse } from "./test-utils";

const HOST = "https://shop.example";
const config: PublicChatConfig = {
  botName: "Acme Bot",
  avatarUrl: null,
  welcomeMessage: "Welcome to Acme!",
  headerTitle: "Acme Support",
  primaryColor: "#facc15",
  position: "left",
  launcherIcon: "sparkle",
  quickReplies: [],
  showBranding: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The API, with each answer held until `finish()` is called. */
function api() {
  const pending: Array<() => void> = [];
  fakeApi((req) => {
    if (req.path === "/public/chatbots/pub1/config") return json(config);
    if (req.path === "/public/chatbots/pub1/conversations") return json({ conversationId: "c1", conversationToken: "t1" }, 201);
    if (req.method === "GET") return json([]);
    return new Promise<Response>((resolve) =>
      pending.push(() =>
        resolve(sseResponse([sse("delta", { text: "We open at 9." }), sse("done", { conversationId: "c1", answeredBy: "llm" })])),
      ),
    );
  });
  return { finish: () => pending.shift()?.() };
}

async function embedded(open = false) {
  const host = fakeHostWindow();
  const server = api();
  render(<App publicId="pub1" hostWindow={host.win} />);
  await screen.findByText(config.welcomeMessage);
  act(() => host.deliver(hostMessage("init", open), HOST));
  const sent = (type: string) => host.posted().filter((m) => m.data.type === type);
  return { ...host, ...server, sent, user: userEvent.setup() };
}

describe("App in the loader's iframe (M4-10)", () => {
  it("says ready, then sends the launcher's look to the host's origin only", async () => {
    const { posted, sent } = await embedded();
    expect(posted()[0]).toEqual({ data: { ns: "brainstack", v: 1, type: "ready" }, target: "*" });
    await waitFor(() => expect(sent("config")).toHaveLength(1));
    expect(sent("config")[0]).toEqual({
      data: { ns: "brainstack", v: 1, type: "config", primaryColor: "#facc15", textColor: "#000000", position: "left", launcherIcon: "sparkle" },
      target: HOST,
    });
  });

  it("asks the host to close from the close button and from Escape", async () => {
    const { sent, user } = await embedded(true);
    await user.click(await screen.findByRole("button", { name: STRINGS.minimizeChat }));
    expect(sent("close")).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(sent("close")).toHaveLength(2);
    expect(sent("close").every((m) => m.target === HOST)).toBe(true);
  });

  it("has no close button on a page opened on its own", async () => {
    api();
    render(<App publicId="pub1" />);
    await screen.findByText(config.welcomeMessage);
    expect(screen.queryByRole("button", { name: STRINGS.minimizeChat })).toBeNull();
  });

  it("focuses the message box each time the host opens the panel", async () => {
    const { deliver, user } = await embedded(true);
    const input = screen.getByRole("textbox", { name: STRINGS.inputLabel });
    await user.click(screen.getByRole("button", { name: STRINGS.minimizeChat }));
    input.blur();
    act(() => deliver(hostMessage("state", false), HOST));
    expect(document.activeElement).not.toBe(input);
    act(() => deliver(hostMessage("state", true), HOST));
    expect(document.activeElement).toBe(input);
  });

  it("counts answers that finish while the panel is closed, and clears the count on open", async () => {
    const { deliver, finish, sent, user } = await embedded(true);
    await user.type(screen.getByRole("textbox", { name: STRINGS.inputLabel }), "When do you open?{Enter}");
    // The visitor closes the chat before the answer comes.
    act(() => deliver(hostMessage("state", false), HOST));
    act(() => finish());
    await screen.findByText("We open at 9.");
    await waitFor(() => expect(sent("unread").map((m) => m.data.count)).toEqual([1]));

    act(() => deliver(hostMessage("state", true), HOST));
    await waitFor(() => expect(sent("unread").map((m) => m.data.count)).toEqual([1, 0]));
  });

  it("asks for a rating as soon as the visitor closes the panel after an answer (M5-7)", async () => {
    const { deliver, finish, user } = await embedded(true);
    await user.type(screen.getByRole("textbox", { name: STRINGS.inputLabel }), "Hi{Enter}");
    act(() => finish());
    await screen.findByText("We open at 9.");
    // The quiet time is long (30 s): only closing brings the prompt now.
    expect(screen.queryByRole("region", { name: STRINGS.ratingQuestion })).toBeNull();

    act(() => deliver(hostMessage("state", false), HOST));
    expect(await screen.findByRole("region", { name: STRINGS.ratingQuestion })).toBeTruthy();
  });

  it("doesn't count an answer the visitor watched arrive", async () => {
    const { finish, sent, user } = await embedded(true);
    await user.type(screen.getByRole("textbox", { name: STRINGS.inputLabel }), "Hi{Enter}");
    act(() => finish());
    await screen.findByText("We open at 9.");
    expect(sent("unread")).toHaveLength(0);
  });
});
