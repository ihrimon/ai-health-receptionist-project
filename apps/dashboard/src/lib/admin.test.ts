import { describe, expect, it } from "vitest";
import { adminQueryString } from "./admin";

describe("adminQueryString", () => {
  it("is empty without filters", () => {
    expect(adminQueryString({})).toBe("");
    expect(adminQueryString({ q: "   " })).toBe("");
  });

  it("trims the search and keeps status, cursor and limit", () => {
    expect(
      adminQueryString({ q: " acme ", status: "SUSPENDED", cursor: "c1", limit: 25 }),
    ).toBe("?q=acme&status=SUSPENDED&cursor=c1&limit=25");
  });
});

import { formatTokens, formatUsd, sortUsageRows, type UsageRow } from "./admin";

const row = (name: string, o: Partial<UsageRow>): UsageRow => ({
  workspaceId: name,
  name,
  plan: "BETA",
  status: "ACTIVE",
  conversations: 0,
  messages: 0,
  previewMessages: 0,
  leads: 0,
  tokensIn: 0,
  tokensOut: 0,
  estimatedCostUsd: 0,
  platformCostUsd: 0,
  ownKeyCostUsd: 0,
  revenueUsd: 0,
  profitUsd: 0,
  ...o,
});

describe("sortUsageRows", () => {
  const rows = [
    row("b", { messages: 5, tokensIn: 10, tokensOut: 10 }),
    row("a", { messages: 9, profitUsd: -3 }),
    row("c", { messages: 5, profitUsd: 20 }),
  ];
  it("sorts numbers high to low, ties by name, without changing the input", () => {
    expect(sortUsageRows(rows, "messages", false).map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.name)).toEqual(["b", "a", "c"]);
  });
  it("sorts ascending, by name and by combined tokens", () => {
    expect(sortUsageRows(rows, "profitUsd", true).map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(sortUsageRows(rows, "name", true).map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(sortUsageRows(rows, "tokens", false)[0].name).toBe("b");
  });
});

describe("formatters", () => {
  it("formats money and tokens", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00012)).toBe("$0.0001");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(-3)).toBe("-$3.00");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(4200)).toBe("4.2K");
    expect(formatTokens(1_234_567)).toBe("1.23M");
  });
});
