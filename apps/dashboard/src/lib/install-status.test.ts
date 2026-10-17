import { describe, expect, it } from "vitest";
import { installStatus } from "./install-status";

const iso = (d: Date) => d.toISOString();

describe("installStatus", () => {
  it("says not detected until the widget has loaded on an allowed site", () => {
    expect(installStatus(null, null)).toMatchObject({
      installed: false,
      title: "Not detected yet",
    });
  });

  it("names the site and time it was first seen", () => {
    expect(installStatus("2026-10-17T09:30:00.000Z", "shop.example.com", iso)).toEqual({
      installed: true,
      title: "Installed",
      detail: "First seen on shop.example.com at 2026-10-17T09:30:00.000Z.",
    });
  });

  it("still shows the time without a site", () => {
    expect(installStatus("2026-10-17T09:30:00.000Z", null, iso).detail).toBe(
      "First seen at 2026-10-17T09:30:00.000Z.",
    );
  });
});
