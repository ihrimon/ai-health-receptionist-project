import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { Markdown, safeHref } from "./markdown";

function md(text: string, streaming = false) {
  const { container } = render(<Markdown text={text} streaming={streaming} />);
  return container.firstElementChild as HTMLElement;
}

const html = (text: string, streaming = false) => md(text, streaming).innerHTML.replace(/ class="[^"]*"/g, "");

describe("Markdown: formatting", () => {
  it("renders bold, italic, code and line breaks", () => {
    expect(html("Hi **there** and *you*\nsee `npm i`")).toBe(
      "<p>Hi <strong>there</strong> and <em>you</em><br>see <code>npm i</code></p>",
    );
  });

  it("splits paragraphs on a blank line and shows headings bold", () => {
    expect(html("## Hours\n\nWe open at 9.\n\nClosed Sunday.")).toBe(
      "<p>Hours</p><p>We open at 9.</p><p>Closed Sunday.</p>",
    );
    expect(md("# Title").querySelector("p")?.className).toContain("font-semibold");
  });

  it("renders bullet and numbered lists", () => {
    expect(html("Options:\n- Small\n- **Large**\n\n3. Third\n4. Fourth")).toBe(
      '<p>Options:</p><ul><li>Small</li><li><strong>Large</strong></li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>',
    );
  });

  it("renders a code block as text", () => {
    expect(html("```\n<b>x</b>\n**y**\n```")).toBe("<pre><code>&lt;b&gt;x&lt;/b&gt;\n**y**</code></pre>");
  });

  it("leaves lone marks, snake_case and escaped stars alone", () => {
    expect(md("2 * 3 = 6, my_file_name, \\*not italic\\*").textContent).toBe("2 * 3 = 6, my_file_name, *not italic*");
    expect(md("2 * 3 = 6, my_file_name").querySelector("em")).toBeNull();
  });
});

describe("Markdown: links", () => {
  it("opens a safe link in a new tab without the opener", () => {
    const a = md("See [our menu](https://acme.test/menu).").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://acme.test/menu");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("our menu");
  });

  it("links bare http(s) URLs without the full stop after them", () => {
    const a = md("Visit https://acme.test/faq.").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://acme.test/faq");
    expect(md("Visit https://acme.test/faq.").textContent).toBe("Visit https://acme.test/faq.");
  });

  it("allows mailto and tel links", () => {
    const hrefs = [...md("[Mail](mailto:hi@acme.test) or [call](tel:+8801700000000)").querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["mailto:hi@acme.test", "tel:+8801700000000"]);
  });

  it("keeps only the text of a relative link", () => {
    const el = md("[pricing](/pricing)");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("pricing");
  });
});

describe("Markdown: XSS", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
    "<iframe src=javascript:alert(1)></iframe>",
    "<svg onload=alert(1)>",
    "**<img src=x onerror=alert(1)>**",
    "[<img src=x onerror=alert(1)>](https://acme.test)",
    "`<script>alert(1)</script>`",
  ];

  it.each(attacks)("shows %s as text, never as HTML", (attack) => {
    const el = md(attack);
    expect(el.querySelector("script, img, iframe, svg, [onerror], [onload]")).toBeNull();
    expect(el.textContent).toContain("<");
    for (const a of el.querySelectorAll("a")) expect(a.getAttribute("href")).toBe("https://acme.test/");
  });

  const badLinks = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "javascript&#58;alert(1)",
    "&#106;avascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.test/x",
    'https://acme.test" onmouseover="alert(1)',
  ];

  it.each(badLinks)("gives no link for [x](%s)", (url) => {
    const el = md(`[click](${url})`);
    expect(el.querySelector("a")).toBeNull();
    expect(el.querySelector("[onmouseover]")).toBeNull();
  });

  it("never links a bare javascript: or data: URL", () => {
    expect(md("javascript:alert(1) data:text/html,<b>x</b>").querySelector("a")).toBeNull();
  });

  it("puts a safe link's quote characters inside the href, not into new attributes", () => {
    const a = md('https://acme.test/?q="onclick=alert(1)').querySelector("a")!;
    expect(a.getAttributeNames().sort()).toEqual(["class", "href", "rel", "target"]);
  });

  it("checks the protocol with the URL parser", () => {
    expect(safeHref("https://acme.test")).toBe("https://acme.test/");
    expect(safeHref("HTTPS://acme.test")).toBe("https://acme.test/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("\u0000javascript:alert(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});

describe("Markdown: while streaming", () => {
  it("shows a mark cut off at the end as already formatted", () => {
    expect(html("We have **free deli", true)).toBe("<p>We have <strong>free deli</strong></p>");
    expect(html("Run `npm", true)).toBe("<p>Run <code>npm</code></p>");
  });

  it("hides a mark that has only just started", () => {
    expect(md("We have **", true).textContent).toBe("We have ");
    expect(md("We have *", true).textContent).toBe("We have ");
  });

  it("shows a half link as its text and links it once complete", () => {
    expect(md("See [our me", true).textContent).toBe("See our me");
    const half = md("See [our menu](https://acme.te", true);
    expect(half.textContent).toBe("See our menu");
    expect(half.querySelector("a")).toBeNull();
    expect(md("See [our menu](https://acme.test)", true).querySelector("a")).toBeTruthy();
  });

  it("only treats the end of the answer as cut off", () => {
    expect(md("a **b\n\nmore", true).querySelector("strong")).toBeNull();
    expect(md("We have **free deli").textContent).toBe("We have **free deli");
  });

  it("shows an open code fence as code until it closes", () => {
    expect(html("```\nline one", true)).toBe("<pre><code>line one</code></pre>");
  });

  it("stays safe on a half-written tag or link", () => {
    expect(md("<img src=x onerr", true).querySelector("img")).toBeNull();
    expect(md("[x](javascript:alert(1)", true).querySelector("a")).toBeNull();
  });
});
