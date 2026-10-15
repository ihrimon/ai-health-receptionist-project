import { describe, expect, it } from "vitest";
import { onboardingProgress, onboardingSteps } from "./onboarding";

const fresh = {
  businessDescription: "",
  knowledgeCount: 0,
  productCount: 0,
  published: false,
};

const doneIds = (input: typeof fresh) =>
  onboardingSteps(input)
    .filter((s) => s.done)
    .map((s) => s.id);

describe("onboardingSteps", () => {
  it("starts with only the account done", () => {
    expect(doneIds(fresh)).toEqual(["account"]);
  });

  it("sends the business step to the chatbot settings, not the test chat", () => {
    const business = onboardingSteps(fresh).find((s) => s.id === "business");
    expect(business?.href).toBe("/app/settings/chatbot");
  });

  it("ticks steps from real data", () => {
    expect(
      doneIds({
        businessDescription: " We sell shoes. ",
        knowledgeCount: 2,
        productCount: 1,
        published: true,
      }),
    ).toEqual(["account", "business", "knowledge", "products", "publish"]);
  });

  it("doesn't count a blank description", () => {
    expect(doneIds({ ...fresh, businessDescription: "   " })).toEqual(["account"]);
  });

  it("marks preview and install as not available yet", () => {
    const unavailable = onboardingSteps(fresh)
      .filter((s) => !s.available)
      .map((s) => s.id);
    expect(unavailable).toEqual(["preview", "install"]);
  });
});

describe("onboardingProgress", () => {
  it("counts done steps out of seven", () => {
    expect(onboardingProgress(onboardingSteps(fresh))).toEqual({
      done: 1,
      total: 7,
      readyForNow: false,
    });
  });

  it("is ready for now once every available, required step is done", () => {
    const live = {
      businessDescription: "We sell shoes.",
      knowledgeCount: 1,
      productCount: 0, // optional
      published: true,
    };
    expect(onboardingProgress(onboardingSteps(live)).readyForNow).toBe(true);
    expect(
      onboardingProgress(onboardingSteps({ ...live, published: false }))
        .readyForNow,
    ).toBe(false);
  });
});
