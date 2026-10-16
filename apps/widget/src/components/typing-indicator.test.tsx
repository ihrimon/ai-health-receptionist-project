import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { STRINGS } from "../strings";
import { TypingIndicator } from "./typing-indicator";

describe("TypingIndicator", () => {
  it("tells screen readers the assistant is typing", () => {
    render(<TypingIndicator />);
    const status = screen.getByRole("status", { name: STRINGS.typing });
    expect(status.querySelectorAll("span")).toHaveLength(3);
  });
});
