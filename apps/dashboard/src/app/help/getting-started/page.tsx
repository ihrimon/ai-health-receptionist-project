import type { Metadata } from "next";
import { DocLink } from "@/components/doc-frame";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Getting started | BrainStack Help" };

export default function GettingStartedPage() {
  return (
    <DocPage
      title="Getting started"
      intro="From sign-up to a chatbot answering visitors on your website."
    >
      <ol>
        <li>
          <strong>Create your account.</strong> Go to{" "}
          <DocLink href="/signup">Sign up</DocLink> with your name, company name,
          work email and a password of at least 10 characters. We send you an
          email: open it and confirm your address, then sign in. Your company
          gets its own workspace with one chatbot already created.
        </li>
        <li>
          <strong>Add your own AI key.</strong> The chatbot uses an AI provider
          account that belongs to your company. Open{" "}
          <em>Settings → AI</em> and paste your key. Until a key is added, the
          chatbot cannot answer visitors.
        </li>
        <li>
          <strong>Add what the chatbot should know.</strong> Open{" "}
          <em>Knowledge</em> (and <em>Products</em> if you sell things) and
          add your FAQs, policies and documents. See{" "}
          <DocLink href="/help/knowledge">Adding knowledge</DocLink>.
        </li>
        <li>
          <strong>Make it yours.</strong> Open <em>Chatbot</em> to set its name,
          welcome message, colours, tone and what it does when it does not
          know an answer (for example, show your phone number or email).
        </li>
        <li>
          <strong>Try it.</strong> Use the test chat in the Chatbot page to ask
          the questions your customers ask. Fix gaps by adding to your
          knowledge.
        </li>
        <li>
          <strong>Publish.</strong> Changes are saved as a draft. Use the
          banner at the top of the page to publish; only published changes are
          seen by visitors.
        </li>
        <li>
          <strong>Put it on your website.</strong> Follow{" "}
          <DocLink href="/help/install">Installing the chat</DocLink>.
        </li>
      </ol>

      <h2>After it is live</h2>
      <ul>
        <li>
          <em>Conversations</em> shows every chat, with its rating if the visitor
          left one. You can delete a conversation if a visitor asks you to.
        </li>
        <li>
          <em>Leads</em> lists contact details visitors chose to leave, and we
          email the workspace owners when a new one arrives.
        </li>
        <li>
          <em>Unanswered</em> shows questions the chatbot could not answer.
          Add them to your knowledge and the chatbot improves.
        </li>
      </ul>

      <p>
        Stuck? Write to us at the address on the{" "}
        <DocLink href="/privacy">Privacy Policy</DocLink> page.
      </p>
    </DocPage>
  );
}
