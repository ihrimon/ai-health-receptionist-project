import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./message-bubble";

const brand = { background: "#ff0000", color: "#ffffff" };

describe("MessageBubble", () => {
  it("shows the visitor's message on the right in the brand color", () => {
    render(
      <MessageBubble role="user" brand={brand}>
        Hello
      </MessageBubble>,
    );
    const bubble = screen.getByText("Hello");
    expect(bubble.dataset.role).toBe("user");
    expect(bubble.className).toContain("ml-auto");
    expect(bubble.style.background).toBe("rgb(255, 0, 0)");
    expect(bubble.style.color).toBe("rgb(255, 255, 255)");
  });

  it("shows the assistant's message on the left without the brand color", () => {
    render(
      <MessageBubble role="assistant" brand={brand}>
        Hi there
      </MessageBubble>,
    );
    const bubble = screen.getByText("Hi there");
    expect(bubble.className).not.toContain("ml-auto");
    expect(bubble.style.background).toBe("");
  });

  it("renders markup in the text as plain text, not HTML", () => {
    render(
      <MessageBubble role="assistant" brand={brand}>
        {"<img src=x onerror=alert(1)>"}
      </MessageBubble>,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
