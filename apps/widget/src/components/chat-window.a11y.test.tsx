import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import type { ChatMessage } from "../types";
import { ChatWindow } from "./chat-window";

/* Keyboard and screen-reader behaviour of the chat window (M4-7). */

const brand = { background: "#2563eb", color: "#ffffff" };
type Props = Parameters<typeof ChatWindow>[0];

function setup(props: Partial<Props> = {}) {
  const base: Props = {
    title: "Acme Support",
    welcomeMessage: "Hi! See [our menu](https://acme.test/menu).",
    messages: [],
    typing: false,
    brand,
    onSend: vi.fn(),
    ...props,
  };
  const view = render(<ChatWindow {...base} />);
  return {
    ...view,
    user: userEvent.setup(),
    update: (next: Partial<Props>) => view.rerender(<ChatWindow {...base} {...next} />),
  };
}

const input = () => screen.getByLabelText(STRINGS.inputLabel);
const announcer = () => screen.getByTestId("announcer");

describe("ChatWindow: keyboard (M4-7)", () => {
  it("puts focus in the message box when the chat opens", () => {
    setup();
    expect(document.activeElement).toBe(input());
  });

  it("closes on Escape when the page can close it, from anywhere in the window", async () => {
    const onClose = vi.fn();
    const { user } = setup({ onClose });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("region", { name: STRINGS.conversation }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores Escape when there is nothing to close", async () => {
    const { user } = setup();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(input());
  });

  it("tabs through close, the conversation, its links and the message box in reading order", async () => {
    const { user } = setup({ onClose: vi.fn() });
    (document.activeElement as HTMLElement).blur();
    const order: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      order.push(el.getAttribute("aria-label") ?? el.textContent);
    }
    // The send button is skipped while the box is empty (Enter sends).
    expect(order).toEqual([STRINGS.closeChat, STRINGS.conversation, "our menu", STRINGS.inputLabel]);
  });

  it("moves focus back to the message box when the control that had it goes away", () => {
    const { update } = setup({ children: <button type="button">Opening hours</button> });
    screen.getByRole("button", { name: "Opening hours" }).focus();
    update({ messages: [{ id: "1", role: "user", text: "Opening hours" }], children: null });
    expect(document.activeElement).toBe(input());
  });

  it("keeps focus where the visitor put it when a message arrives", () => {
    const { update } = setup({ onClose: vi.fn() });
    const close = screen.getByRole("button", { name: STRINGS.closeChat });
    close.focus();
    update({ onClose: vi.fn(), messages: [{ id: "1", role: "assistant", text: "Hello" }] });
    expect(document.activeElement).toBe(close);
  });
});

describe("ChatWindow: screen readers (M4-7)", () => {
  it("labels every control and keeps the message list out of the live region", () => {
    setup({ onClose: vi.fn() });
    expect(screen.getByRole("button", { name: STRINGS.closeChat })).toBeTruthy();
    expect(screen.getByRole("button", { name: STRINGS.send })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: STRINGS.inputLabel })).toBeTruthy();
    const list = screen.getByRole("region", { name: STRINGS.conversation });
    expect(list.closest("[aria-live]")).toBeNull();
    expect(announcer().getAttribute("aria-live")).toBe("polite");
  });

  it("announces an answer once it is complete, not while it streams", () => {
    const question: ChatMessage = { id: "1", role: "user", text: "Hours?" };
    const { update } = setup();
    update({ messages: [question], typing: true, busy: true });
    expect(announcer().textContent).toBe("");

    update({ messages: [question, { id: "2", role: "assistant", text: "We open", streaming: true }], busy: true });
    expect(announcer().textContent).toBe("");

    update({ messages: [question, { id: "2", role: "assistant", text: "We open **at 9**." }], busy: false });
    // Read as plain text: the Markdown marks are not spoken.
    expect(announcer().textContent).toBe("We open at 9.");
  });

  it("announces an error note that replaces a broken answer", () => {
    const question: ChatMessage = { id: "1", role: "user", text: "Hours?" };
    const { update } = setup();
    update({ messages: [question], typing: true, busy: true });
    update({ messages: [question, { id: "3", role: "assistant", text: STRINGS.somethingWrong }], typing: false, busy: false });
    expect(announcer().textContent).toBe(STRINGS.somethingWrong);
  });

  it("does not read out the history loaded when the chat opens", () => {
    const { update } = setup();
    update({
      messages: [
        { id: "1", role: "user", text: "Earlier question" },
        { id: "2", role: "assistant", text: "Earlier answer" },
      ],
    });
    expect(announcer().textContent).toBe("");
  });
});
