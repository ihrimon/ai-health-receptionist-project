import type { ComponentChildren, VNode } from "preact";

/*
 * The small Markdown subset an answer uses (M4-5): paragraphs and line
 * breaks, bullet and numbered lists, headings (shown bold), code blocks,
 * `code`, **bold**, *italic*, [links](https://…) and bare http(s) links.
 *
 * Safe by construction: the text is turned into Preact elements, never into
 * an HTML string, so any markup in the answer (`<script>`, `<img onerror>`)
 * is shown as text. A link keeps its href only for http, https, mailto and
 * tel, and opens in a new tab with `rel="noopener noreferrer"`; anything
 * else (javascript:, data:, relative URLs) stays plain text.
 *
 * While an answer is still streaming (`streaming`), the end of the text may
 * be cut in the middle of a mark: `**bo` is shown bold already and
 * `[Our site](https://exa` as its text, so no stray `**` flickers by.
 */

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

/** The href to use for `url`, or null when it is not a safe absolute link. */
export function safeHref(url: string): string | null {
  // No spaces or control characters anywhere (they hide schemes: "java\tscript:").
  // eslint-disable-next-line no-control-regex
  if (!url || /[\s\u0000-\u001f\u007f]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null; // relative or broken
  }
}

export function SafeLink({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" class="underline break-all">
      {children}
    </a>
  );
}

type Inline = string | VNode;

const EMPHASIS: Record<string, (children: Inline[]) => VNode> = {
  "**": (c) => <strong>{c}</strong>,
  __: (c) => <strong>{c}</strong>,
  "*": (c) => <em>{c}</em>,
  _: (c) => <em>{c}</em>,
};

/** Where the closing `mark` is, or -1. A closer has no space before it. */
function closer(text: string, mark: string, from: number): number {
  for (let j = text.indexOf(mark, from); j !== -1; j = text.indexOf(mark, j + 1)) {
    const single = mark.length === 1;
    if (j > from && text[j - 1] !== " " && !(single && (text[j + 1] === mark || text[j - 1] === mark))) {
      return j;
    }
  }
  return -1;
}

const BARE_URL = /^https?:\/\/[^\s<>()]+/;

/** One line (or list item) of inline marks. `partial`: it may end mid-mark. */
export function inline(text: string, partial = false, links = true): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);

    // \* stays a star.
    if (ch === "\\" && /[\\`*_[\]()#+\-.!]/.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1 || (end === -1 && partial && i + 1 < text.length)) {
        flush();
        const stop = end === -1 ? text.length : end;
        out.push(<code class="rounded bg-zinc-200 px-1 font-mono text-[0.9em]">{text.slice(i + 1, stop)}</code>);
        i = stop + 1;
        continue;
      }
    }

    const mark = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" : ch === "*" || ch === "_" ? ch : "";
    // An opener is followed by text; `_` only opens at a word's start (not snake_case).
    if (mark && text[i + mark.length] && text[i + mark.length] !== " " && !(ch === "_" && /\w/.test(text[i - 1] ?? ""))) {
      const start = i + mark.length;
      const end = closer(text, mark, start);
      if (end !== -1 || partial) {
        flush();
        const stop = end === -1 ? text.length : end;
        out.push(EMPHASIS[mark](inline(text.slice(start, stop), partial && end === -1, links)));
        i = stop + mark.length;
        continue;
      }
    }
    // A mark cut off at the very end of a streaming answer: wait for the rest.
    if (mark && partial && i + mark.length >= text.length) break;

    if (ch === "[" && links) {
      const close = text.indexOf("]", i + 1);
      const label = close === -1 ? null : text.slice(i + 1, close);
      if (label !== null && text[close + 1] === "(") {
        const paren = text.indexOf(")", close + 2);
        if (paren !== -1 || partial) {
          flush();
          const url = paren === -1 ? "" : text.slice(close + 2, paren).trim();
          const href = paren === -1 ? null : safeHref(url);
          const children = inline(label || url, false, false);
          // Not (yet) a safe link: only its text.
          if (href) out.push(<SafeLink href={href}>{children}</SafeLink>);
          else out.push(...children);
          i = paren === -1 ? text.length : paren + 1;
          continue;
        }
      } else if (partial && (close === -1 || close === text.length - 1)) {
        // "[Our si" or "[Our site]" still coming in.
        flush();
        out.push(...inline(text.slice(i + 1, close === -1 ? text.length : close), true, false));
        break;
      }
    }

    if (links && (ch === "h" || ch === "H") && !/\w/.test(text[i - 1] ?? "")) {
      const found = BARE_URL.exec(rest);
      if (found) {
        // A sentence's full stop or comma is not part of the link.
        const url = found[0].replace(/[.,;:!?'"]+$/, "");
        const href = safeHref(url);
        if (href) {
          flush();
          out.push(<SafeLink href={href}>{url}</SafeLink>);
          i += url.length;
          continue;
        }
      }
    }

    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "code"; text: string }
  | { kind: "ul" | "ol"; items: string[]; start: number };

const LIST_ITEM = /^\s{0,3}(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;

/** Splits the text into blocks, line by line. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const last = out[out.length - 1];

    if (/^\s{0,3}```/.test(line)) {
      // A fence with no end (still streaming) runs to the end of the text.
      const code: string[] = [];
      while (++i < lines.length && !/^\s{0,3}```/.test(lines[i])) code.push(lines[i]);
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] }); // a break; empty blocks are dropped
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push({ kind: "h", text: heading[1] });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      if (last?.kind === kind) last.items.push(item[3]);
      else out.push({ kind, items: [item[3]], start: Number(item[2] ?? 1) });
      continue;
    }
    // A wrapped line of a list item, or of a paragraph.
    if ((last?.kind === "ul" || last?.kind === "ol") && /^\s+\S/.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
    } else if (last?.kind === "p" && last.lines.length) {
      last.lines.push(line);
    } else {
      out.push({ kind: "p", lines: [line] });
    }
  }
  return out.filter((b) => b.kind !== "p" || b.lines.length);
}

/** An assistant's answer as safe Markdown. */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const list = blocks(text);
  return (
    <div class="space-y-2">
      {list.map((block, n) => {
        const partial = streaming && n === list.length - 1;
        switch (block.kind) {
          case "code":
            return (
              <pre key={n} class="overflow-x-auto rounded-lg bg-zinc-200 p-2 font-mono text-xs whitespace-pre">
                <code>{block.text}</code>
              </pre>
            );
          case "h":
            return (
              <p key={n} class="font-semibold">
                {inline(block.text, partial)}
              </p>
            );
          case "ul":
          case "ol": {
            const Tag = block.kind;
            return (
              <Tag
                key={n}
                start={block.kind === "ol" && block.start !== 1 ? block.start : undefined}
                class={`space-y-1 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}
              >
                {block.items.map((item, k) => (
                  <li key={k}>{inline(item, partial && k === block.items.length - 1)}</li>
                ))}
              </Tag>
            );
          }
          default:
            return (
              <p key={n}>
                {block.lines.map((line, k) => [
                  k > 0 && <br />,
                  inline(line, partial && k === block.lines.length - 1),
                ])}
              </p>
            );
        }
      })}
    </div>
  );
}
