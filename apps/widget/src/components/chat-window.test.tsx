import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import type { ChatMessage } from "../types";
import { ChatWindow } from "./chat-window";

const brand = { background: "#2563eb", color: "#ffffff" };
const messages: ChatMessage[] = [
  { id: "1", role: "user", text: "What are your hours?" },
  { id: "2", role: "assistant", text: "We're open 9 to 5." },
];

function setup(props: Partial<Parameters<typeof ChatWindow>[0]> = {}) {
  const onSend = vi.fn();
  render(
    <ChatWindow
      title="Acme Support"
      welcomeMessage="Hi! Ask me anything."
      messages={messages}
      typing={false}
      brand={brand}
      onSend={onSend}
      {...props}
    />,
  );
  return { onSend, user: userEvent.setup() };
}

describe("ChatWindow", () => {
  it("shows the title, the welcome message and the conversation in order", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Acme Support" })).toBeTruthy();
    const texts = [...document.querySelectorAll("[data-role]")].map((el) => el.textContent);
    expect(texts).toEqual(["Hi! Ask me anything.", "What are your hours?", "We're open 9 to 5."]);
  });

  it("shows the typing indicator and holds sending while waiting", async () => {
    const { onSend, user } = setup({ typing: true });
    expect(screen.getByRole("status", { name: STRINGS.typing })).toBeTruthy();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Another{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hides the typing indicator otherwise and passes messages up", async () => {
    const { onSend, user } = setup();
    expect(screen.queryByRole("status")).toBeNull();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Thanks{Enter}");
    expect(onSend).toHaveBeenCalledWith("Thanks");
  });

  it("has a close button only when the page can close it", async () => {
    setup();
    expect(screen.queryByRole("button", { name: STRINGS.closeChat })).toBeNull();
    const onClose = vi.fn();
    cleanup();
    const { user } = setup({ onClose });
    await user.click(screen.getByRole("button", { name: STRINGS.closeChat }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows extra content under the messages and the branding line by default", () => {
    setup({ children: <p>Extra slot</p> });
    expect(screen.getByText("Extra slot")).toBeTruthy();
    expect(screen.getByText(STRINGS.poweredBy)).toBeTruthy();
  });

  it("can hide the branding line", () => {
    setup({ showBranding: false });
    expect(screen.queryByText(STRINGS.poweredBy)).toBeNull();
  });

  it("shows the assistant's Markdown formatted and the visitor's text as typed", () => {
    setup({
      welcomeMessage: "Hi! I'm **Acme Bot**.",
      messages: [
        { id: "1", role: "user", text: "**not bold** <b>x</b>" },
        { id: "2", role: "assistant", text: "See [our menu](https://acme.test/menu) <img src=x onerror=alert(1)>" },
      ],
    });
    const [welcome, mine, answer] = document.querySelectorAll("[data-role]");
    expect(welcome.querySelector("strong")?.textContent).toBe("Acme Bot");
    expect(mine.textContent).toBe("**not bold** <b>x</b>");
    expect(mine.querySelector("strong, b")).toBeNull();
    expect(answer.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(answer.querySelector("img")).toBeNull();
  });

  it("puts the handoff button under the fallback answer it came with", () => {
    setup({
      messages: [
        { id: "1", role: "user", text: "Refund?" },
        {
          id: "2",
          role: "assistant",
          text: "Sorry, I don't know.",
          handoff: { kind: "email", value: "help@acme.test", label: "Email support" },
        },
      ],
    });
    const link = screen.getByRole("link", { name: "Email support" });
    expect(link.getAttribute("href")).toBe("mailto:help@acme.test");
    expect(link.previousElementSibling?.textContent).toBe("Sorry, I don't know.");
  });

  it("tells the visitor an AI answers and the chat is saved (M7-14)", () => {
    setup();
    expect(screen.getByTestId("privacy-notice").textContent).toContain(STRINGS.privacyNotice);
    expect(screen.queryByRole("link", { name: STRINGS.privacyLink })).toBeNull();
  });

  it("links the notice to the Privacy Policy when the API gives its address", () => {
    setup({ privacyUrl: "https://app.example.com/privacy" });
    const link = screen.getByRole("link", { name: STRINGS.privacyLink });
    expect(link.getAttribute("href")).toBe("https://app.example.com/privacy");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
