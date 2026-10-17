import { defaultChatbotConfig } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  addChip,
  bannerState,
  checkDraft,
  hasUnsavedEdits,
  MAX_QUESTIONS,
  newQuestion,
  sameJson,
  tabForField,
} from "./config-form";

const saved = () => {
  const config = defaultChatbotConfig("Acme");
  config.business.description = "We sell shoes.";
  return config;
};

describe("checkDraft", () => {
  it("returns the parsed config when the draft is valid", () => {
    const draft = saved();
    draft.identity.botName = "  Ava  ";

    const check = checkDraft(draft);

    expect(check.ok && check.config.identity.botName).toBe("Ava");
  });

  it("returns one message per broken field, keyed by its path", () => {
    const draft = saved();
    draft.identity.botName = "";
    draft.widget.primaryColor = "teal";

    const check = checkDraft(draft);

    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(Object.keys(check.errors).sort()).toEqual([
        "identity.botName",
        "widget.primaryColor",
      ]);
      expect(check.errors["widget.primaryColor"]).toBe(
        "Must be a #RRGGBB color",
      );
    }
  });
});

describe("hasUnsavedEdits", () => {
  it("is false for the saved config, even with blank or padded fields", () => {
    const draft = saved();
    draft.business.contact.phone = "";
    draft.identity.botName = ` ${draft.identity.botName} `;

    expect(hasUnsavedEdits(saved(), draft)).toBe(false);
  });

  it("is true after a real change, or while the draft is invalid", () => {
    const changed = saved();
    changed.behavior.tone = "casual";
    const invalid = saved();
    invalid.identity.botName = "";

    expect(hasUnsavedEdits(saved(), changed)).toBe(true);
    expect(hasUnsavedEdits(saved(), invalid)).toBe(true);
  });
});

describe("sameJson", () => {
  it("ignores key order, as the database returns it", () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(
      true,
    );
    expect(sameJson({ a: 1 }, { a: 1, b: null })).toBe(false);
  });
});

describe("addChip", () => {
  it("adds trimmed text", () => {
    expect(addChip(["Shoes"], "  Bags ", 20, 80)).toEqual({
      list: ["Shoes", "Bags"],
    });
  });

  it("ignores blanks and refuses repeats, overflow and long text", () => {
    expect(addChip(["Shoes"], "   ", 20, 80)).toEqual({ list: ["Shoes"] });
    expect(addChip(["Shoes"], "shoes", 20, 80).error).toBe(
      "Already in the list",
    );
    expect(addChip(["a", "b"], "c", 2, 80).error).toBe("At most 2 items");
    expect(addChip([], "x".repeat(81), 20, 80).error).toBe(
      "At most 80 characters",
    );
  });
});

describe("bannerState", () => {
  const live = { version: 1, publishedAt: "2026-10-14T10:00:00Z" };

  it("is hidden when the draft is live", () => {
    expect(
      bannerState({
        publishedVersion: live,
        hasUnpublishedChanges: false,
        publishProblems: [],
      }),
    ).toEqual({ show: false });
  });

  it("offers Publish for unpublished changes", () => {
    expect(
      bannerState({
        publishedVersion: live,
        hasUnpublishedChanges: true,
        publishProblems: [],
      }),
    ).toEqual({
      show: true,
      label: "Unpublished changes",
      canPublish: true,
      reasons: [],
    });
  });

  it("explains why a never-published bot can't be published yet", () => {
    expect(
      bannerState({
        publishedVersion: null,
        hasUnpublishedChanges: true,
        publishProblems: [
          { code: "KNOWLEDGE_MISSING", message: "Add at least one FAQ." },
        ],
      }),
    ).toEqual({
      show: true,
      label: "Not published yet",
      canPublish: false,
      reasons: ["Add at least one FAQ."],
    });
  });
});

describe("tabForField", () => {
  it("finds the tab that shows a field", () => {
    expect(tabForField("identity.botName")).toBe("general");
    expect(tabForField("business.contact.email")).toBe("general");
    expect(tabForField("behavior.handoff.value")).toBe("behavior");
    expect(tabForField("widget.quickReplies")).toBe("appearance");
  });
});

describe("newQuestion", () => {
  it("makes a blank custom question with an ID the schema accepts", () => {
    const question = newQuestion([]);
    expect(question).toMatchObject({
      question: "",
      field: "custom",
      required: false,
      askWhen: "before_recommendation",
    });
    expect(question.id).toMatch(/^q_[a-z0-9]{6}$/);
  });

  it("never reuses an existing ID", () => {
    const first = newQuestion([], () => 0);
    const rolls = [0, 0, 0.5];
    const second = newQuestion([first], () => rolls.shift() ?? 0.9);
    expect(second.id).not.toBe(first.id);
  });

  it("validates with the shared schema once the question is written", () => {
    const draft = saved();
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const q = newQuestion(draft.behavior.questionsToAsk);
      q.question = `Question ${i}?`;
      draft.behavior.questionsToAsk.push(q);
    }
    expect(checkDraft(draft).ok).toBe(true);
    draft.behavior.questionsToAsk[0].question = " ";
    const check = checkDraft(draft);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(Object.keys(check.errors)).toEqual([
        "behavior.questionsToAsk.0.question",
      ]);
    }
    draft.behavior.questionsToAsk[0].question = "Name?";
    draft.behavior.questionsToAsk.push(newQuestion([]));
    expect(checkDraft(draft).ok).toBe(false);
  });
});
