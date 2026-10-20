/**
 * Helpers around the embed snippet (Install page, M7-39): the snippet the
 * API gives is `<script src="…/chatbot.js" data-chatbot-id="cb_…" async></script>`.
 */

export interface SnippetParts {
  /** The loader's address, `https://…/chatbot.js`. */
  src: string;
  /** The chatbot's public id, `cb_…`. */
  chatbotId: string;
}

/** The loader address and chatbot id inside a snippet, or null if it isn't one. */
export function parseSnippet(snippet: string): SnippetParts | null {
  const src = /\ssrc="([^"]+)"/.exec(snippet)?.[1];
  const chatbotId = /\sdata-chatbot-id="([^"]+)"/.exec(snippet)?.[1];
  return src && chatbotId ? { src, chatbotId } : null;
}

/**
 * The snippet as shown and copied on the Install page: a one-line comment
 * names the site(s) it is for, so it is clear where to paste it. With no
 * domain yet, the snippet is unchanged.
 */
export function snippetForDomains(snippet: string, domains: string[]): string {
  const sites = domains.filter((d) => !d.startsWith("*."));
  if (sites.length === 0) return snippet;
  return `<!-- BrainStack chatbot for ${sites.join(", ")} -->\n${snippet}`;
}

/** Next.js (App Router): `app/layout.tsx`. */
export function nextLayoutCode({ src, chatbotId }: SnippetParts): string {
  return `import Script from "next/script";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${src}"
          data-chatbot-id="${chatbotId}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;
}

/** Next.js (Pages Router): `pages/_app.tsx`. */
export function nextPagesCode({ src, chatbotId }: SnippetParts): string {
  return `import type { AppProps } from "next/app";
import Script from "next/script";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Script
        src="${src}"
        data-chatbot-id="${chatbotId}"
        strategy="afterInteractive"
      />
    </>
  );
}`;
}

/** React (Vite, Create React App and similar): a small component. */
export function reactComponentCode({ src, chatbotId }: SnippetParts): string {
  return `import { useEffect } from "react";

export function BrainStackChat() {
  useEffect(() => {
    if (document.querySelector('script[data-chatbot-id="${chatbotId}"]')) return;
    const script = document.createElement("script");
    script.src = "${src}";
    script.async = true;
    script.setAttribute("data-chatbot-id", "${chatbotId}");
    document.body.appendChild(script);
  }, []);

  return null;
}`;
}
