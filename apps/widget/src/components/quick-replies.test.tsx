import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { QuickReplies } from "./quick-replies";

const brand = { background: "#2563eb", color: "#ffffff" };

describe("QuickReplies", () => {
  it("shows a chip per reply and passes the picked text up", async () => {
    const onPick = vi.fn();
    render(<QuickReplies replies={["Opening hours", "Delivery"]} brand={brand} onPick={onPick} />);
    expect(screen.getByRole("group", { name: STRINGS.quickReplies })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Delivery" }));
    expect(onPick).toHaveBeenCalledWith("Delivery");
  });

  it("shows nothing without replies", () => {
    render(<QuickReplies replies={[]} brand={brand} onPick={vi.fn()} />);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows a reply's markup as text", () => {
    render(<QuickReplies replies={["<img src=x onerror=alert(1)>"]} brand={brand} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "<img src=x onerror=alert(1)>" })).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
