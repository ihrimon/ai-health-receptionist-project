import { describe, expect, it } from "vitest";
import {
  nextLayoutCode,
  nextPagesCode,
  parseSnippet,
  reactComponentCode,
  snippetForDomains,
} from "./install-snippet";

const snippet =
  '<script src="https://app.example.com/chatbot.js" data-chatbot-id="cb_AbC123" async></script>';

describe("parseSnippet", () => {
  it("reads the loader address and chatbot id", () => {
    expect(parseSnippet(snippet)).toEqual({
      src: "https://app.example.com/chatbot.js",
      chatbotId: "cb_AbC123",
    });
  });

  it("returns null for anything else", () => {
    expect(parseSnippet("<p>hello</p>")).toBeNull();
    expect(parseSnippet("")).toBeNull();
  });
});

describe("snippetForDomains", () => {
  it("names the site above the snippet", () => {
    expect(
      snippetForDomains(snippet, ["knkoglobal.com", "www.knkoglobal.com"]),
    ).toBe(
      `<!-- BrainStack chatbot for knkoglobal.com, www.knkoglobal.com -->\n${snippet}`,
    );
  });

  it("leaves the snippet alone with no domain, or only wildcards", () => {
    expect(snippetForDomains(snippet, [])).toBe(snippet);
    expect(snippetForDomains(snippet, ["*.vercel.app"])).toBe(snippet);
  });

  it("keeps the script tag intact so it still parses", () => {
    expect(parseSnippet(snippetForDomains(snippet, ["a.com"]))).not.toBeNull();
  });
});

describe("framework code", () => {
  const parts = parseSnippet(snippet)!;

  it("puts the company's own loader address and chatbot id in every example", () => {
    for (const code of [
      nextLayoutCode(parts),
      nextPagesCode(parts),
      reactComponentCode(parts),
    ]) {
      expect(code).toContain("https://app.example.com/chatbot.js");
      expect(code).toContain("cb_AbC123");
    }
  });

  it("uses next/script for Next.js and a plain script element for React", () => {
    expect(nextLayoutCode(parts)).toContain('from "next/script"');
    expect(nextPagesCode(parts)).toContain('from "next/script"');
    expect(reactComponentCode(parts)).toContain("document.createElement");
    expect(reactComponentCode(parts)).not.toContain("next/script");
  });
});
