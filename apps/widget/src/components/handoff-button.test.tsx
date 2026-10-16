import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { STRINGS } from "../strings";
import { HandoffButton, handoffHref } from "./handoff-button";

const brand = { background: "#2563eb", color: "#ffffff" };

describe("HandoffButton", () => {
  it("links to each kind of contact the company can set", () => {
    expect(handoffHref({ kind: "email", value: "help@acme.test", label: null })).toBe("mailto:help@acme.test");
    expect(handoffHref({ kind: "phone", value: "+880 1700-000000", label: null })).toBe("tel:+8801700000000");
    expect(handoffHref({ kind: "whatsapp", value: "+880 1700-000000", label: null })).toBe("https://wa.me/8801700000000");
    expect(handoffHref({ kind: "url", value: "https://acme.test/contact", label: null })).toBe("https://acme.test/contact");
  });

  it("refuses a value that would not make a safe link", () => {
    expect(handoffHref({ kind: "url", value: "javascript:alert(1)", label: null })).toBeNull();
    expect(handoffHref({ kind: "email", value: "a@b.test?bcc=all@x.test", label: null })).toBeNull();
    expect(handoffHref({ kind: "phone", value: "call us", label: null })).toBeNull();
    render(<HandoffButton handoff={{ kind: "url", value: "javascript:alert(1)", label: "Click" }} brand={brand} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the company's label in a new tab, or a default one", () => {
    const { rerender } = render(
      <HandoffButton handoff={{ kind: "whatsapp", value: "+8801700000000", label: "Talk to Rina" }} brand={brand} />,
    );
    const link = screen.getByRole("link", { name: "Talk to Rina" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.style.background).toBe("rgb(37, 99, 235)");
    rerender(<HandoffButton handoff={{ kind: "email", value: "help@acme.test", label: null }} brand={brand} />);
    expect(screen.getByRole("link", { name: STRINGS.handoff.email })).toBeTruthy();
  });
});
