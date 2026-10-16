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
});
