import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { MESSAGE_MAX_CHARS } from "../types";
import { MessageInput } from "./message-input";

const brand = { background: "#000000", color: "#ffffff" };

function setup(disabled = false) {
  const onSend = vi.fn();
  render(<MessageInput onSend={onSend} disabled={disabled} brand={brand} />);
  return {
    onSend,
    box: screen.getByLabelText(STRINGS.inputLabel) as HTMLTextAreaElement,
    button: screen.getByRole("button", { name: STRINGS.send }) as HTMLButtonElement,
    user: userEvent.setup(),
  };
}

describe("MessageInput", () => {
  it("sends the trimmed text on Enter and clears the box", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "  Do you ship to Dhaka?  {Enter}");
    expect(onSend).toHaveBeenCalledWith("Do you ship to Dhaka?");
    expect(box.value).toBe("");
  });

  it("starts a new line on Shift+Enter instead of sending", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("Line one\nLine two");
  });

  it("sends with the button", async () => {
    const { onSend, box, button, user } = setup();
    await user.type(box, "Hello");
    await user.click(button);
    expect(onSend).toHaveBeenCalledWith("Hello");
  });

  it("doesn't send a blank message", async () => {
    const { onSend, box, button, user } = setup();
    expect(button.disabled).toBe(true);
    await user.type(box, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
  });

  it("doesn't send while an answer is still coming", async () => {
    const { onSend, box, button, user } = setup(true);
    await user.type(box, "Hello{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    // The typed text is kept for when sending is allowed again.
    expect(box.value).toBe("Hello");
  });

  it("limits the message to the API's length", () => {
    const { box } = setup();
    expect(box.maxLength).toBe(MESSAGE_MAX_CHARS);
  });
});
