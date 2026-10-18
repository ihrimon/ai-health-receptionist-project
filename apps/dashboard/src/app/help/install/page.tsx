import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Installing the chat | BrainStack Help" };

export default function InstallHelpPage() {
  return (
    <DocPage
      title="Installing the chat on your website"
      intro="One line of code puts the chat on your site. Everything below is under Settings → Install in your dashboard, where your own snippet is shown."
    >
      <ol>
        <li>
          <strong>Allow your domain.</strong> Under <em>Allowed domains</em>,
          add the address of your site (for example{" "}
          <code>www.example.com</code>). The chat only opens on sites you
          list, so nobody else can embed your chatbot.
        </li>
        <li>
          <strong>Publish.</strong> Make sure your chatbot is published and
          switched on, and that you have added your AI key.
        </li>
        <li>
          <strong>Copy the snippet.</strong> It is one <code>&lt;script&gt;</code>{" "}
          tag with your chatbot&apos;s public ID.
        </li>
        <li>
          <strong>Paste it into your site</strong>, just before the closing{" "}
          <code>&lt;/body&gt;</code> tag on every page where the chat should
          appear. On Shopify, WooCommerce, WordPress and other platforms there
          are step-by-step guides on the same Install page.
        </li>
        <li>
          <strong>Check.</strong> Open your site. A chat button appears in the
          corner. The Install page shows when the chat has loaded on your site; use{" "}
          <em>Check again</em> if it has not noticed yet.
        </li>
      </ol>

      <h2>If it does not show up</h2>
      <ul>
        <li>
          The domain must match exactly what visitors see, including{" "}
          <code>www</code> or not. Add both if you use both.
        </li>
        <li>Publish after your last change.</li>
        <li>
          Some site builders strip script tags. Use their &quot;custom code&quot;
          or &quot;footer scripts&quot; setting.
        </li>
        <li>
          Browser extensions such as ad blockers can hide the chat on your own
          computer. Try a private window.
        </li>
      </ul>

      <p>
        Back to <Link href="/help">all help articles</Link>.
      </p>
    </DocPage>
  );
}
