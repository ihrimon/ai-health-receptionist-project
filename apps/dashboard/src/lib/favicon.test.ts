import { describe, expect, it } from "vitest";
import { faviconDataUrl, faviconSvg } from "./favicon";

describe("faviconSvg", () => {
  it("uses the accent for the background and the ink for the drawing", () => {
    const svg = faviconSvg("#e11d48", "#ffffff");
    expect(svg).toContain('<rect width="24" height="24" rx="6" fill="#e11d48"/>');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).not.toContain("#059669");
  });

  it("switches the ink on a light accent", () => {
    const svg = faviconSvg("#facc15", "#111111");
    expect(svg).toContain('fill="#facc15"');
    expect(svg).toContain('stroke="#111111"');
    expect(svg).not.toContain("#ffffff");
  });
});

describe("faviconDataUrl", () => {
  it("is a url-encoded SVG data url that round-trips", () => {
    const url = faviconDataUrl("#4f46e5", "#ffffff");
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml,".length))).toBe(
      faviconSvg("#4f46e5", "#ffffff"),
    );
    expect(url).not.toContain("<");
  });
});
