import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./app";
import { STRINGS } from "./strings";

describe("App", () => {
  it("opens with the welcome message and shows what the visitor sends", async () => {
    render(<App />);
    expect(screen.getByText("Hi! How can I help you today?")).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(STRINGS.inputLabel), "Hello{Enter}");
    expect(screen.getByText("Hello").dataset.role).toBe("user");
  });
});
