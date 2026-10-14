import ReactMarkdown, { type Components } from "react-markdown";

// The dashboard has no typography plugin, so each element is styled here.
const COMPONENTS: Components = {
  h1: (props) => <h1 className="mt-4 mb-2 text-xl font-semibold first:mt-0" {...props} />,
  h2: (props) => <h2 className="mt-4 mb-2 text-lg font-semibold first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-3 mb-1 font-semibold first:mt-0" {...props} />,
  p: (props) => <p className="my-2 leading-relaxed" {...props} />,
  ul: (props) => <ul className="my-2 list-disc pl-5" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal pl-5" {...props} />,
  li: (props) => <li className="my-0.5" {...props} />,
  a: (props) => (
    <a className="text-primary underline" target="_blank" rel="noreferrer" {...props} />
  ),
  code: (props) => <code className="rounded bg-muted px-1 text-[0.9em]" {...props} />,
  blockquote: (props) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...props} />
  ),
};

/**
 * Renders a policy page's Markdown for the preview. react-markdown never
 * renders raw HTML by default, so pasted HTML shows as text, not markup.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown components={COMPONENTS}>{children}</ReactMarkdown>
    </div>
  );
}
