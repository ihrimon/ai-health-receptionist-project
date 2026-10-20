import { describe, expect, it } from "vitest";
import {
  changedFields,
  formOf,
  passwordProblem,
  timeZoneNames,
  type WorkspaceProfile,
} from "./workspace-settings";

const profile: WorkspaceProfile = {
  id: "w1",
  name: "Acme",
  slug: "acme",
  status: "ACTIVE",
  plan: "BETA",
  createdAt: "2026-10-01T00:00:00Z",
  website: "https://acme.test",
  industry: null,
  contactEmail: null,
  contactPhone: null,
  timeZone: "UTC",
};

describe("changedFields", () => {
  it("is null when nothing changed, even with stray spaces", () => {
    expect(changedFields(profile, formOf(profile))).toBeNull();
    expect(changedFields(profile, { ...formOf(profile), name: " Acme " })).toBeNull();
  });

  it("sends only what changed", () => {
    expect(
      changedFields(profile, { ...formOf(profile), industry: " HVAC ", timeZone: "Asia/Dhaka" }),
    ).toEqual({ industry: "HVAC", timeZone: "Asia/Dhaka" });
  });

  it("sends an emptied detail as blank, so the API clears it", () => {
    expect(changedFields(profile, { ...formOf(profile), website: "  " })).toEqual({
      website: "",
    });
  });
});

describe("formOf", () => {
  it("shows an unset detail as an empty box", () => {
    expect(formOf(profile)).toMatchObject({ industry: "", contactEmail: "", website: "https://acme.test" });
  });
});

describe("passwordProblem", () => {
  it("asks for what is missing, in order", () => {
    expect(passwordProblem("", "long enough pw", "long enough pw", 10)).toMatch(/current/);
    expect(passwordProblem("old", "short", "short", 10)).toMatch(/at least 10/);
    expect(passwordProblem("same password 1", "same password 1", "same password 1", 10)).toMatch(
      /different/,
    );
    expect(passwordProblem("old", "a new password", "another one", 10)).toMatch(/don't match/);
  });

  it("is fine with a good new password typed twice", () => {
    expect(passwordProblem("old", "a new password", "a new password", 10)).toBeNull();
  });
});

describe("timeZoneNames", () => {
  it("starts with UTC and has no duplicate", () => {
    const names = timeZoneNames();
    expect(names[0]).toBe("UTC");
    expect(new Set(names).size).toBe(names.length);
  });
});
