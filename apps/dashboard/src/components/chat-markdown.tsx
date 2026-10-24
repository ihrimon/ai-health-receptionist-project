import ReactMarkdown, { type Components } from "react-markdown";

// A chat bubble is small, so the elements sit close together.
const COMPONENTS: Components = {
  p: (props) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0" {...props} />,
  a: (props) => <a className="underline" target="_blank" rel="noreferrer" {...props} />,
  code: (props) => <code className="rounded bg-background/60 px-1 text-[0.9em]" {...props} />,
};

/**
 * An assistant's answer as it looks to a visitor: bold prices and short
 * lists instead of raw `**` and `- ` marks (the widget does the same).
 * react-markdown never renders raw HTML, so markup in an answer shows as text.
 */
export function ChatMarkdown({ children }: { children: string }) {
  return <ReactMarkdown components={COMPONENTS}>{children}</ReactMarkdown>;
}
