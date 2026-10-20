import type { Metadata } from "next";
import { DocLink } from "@/components/doc-frame";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Adding knowledge | BrainStack Help" };

export default function KnowledgeHelpPage() {
  return (
    <DocPage
      title="Adding knowledge"
      intro="The chatbot answers only from what you give it. The more accurate your content, the better the answers."
    >
      <h2>What you can add</h2>
      <ul>
        <li>
          <strong>FAQs</strong>: a question and its answer. Best for things
          visitors ask often. Up to 25.
        </li>
        <li>
          <strong>Custom answers</strong>: exact replies for specific
          questions, used word for word. Up to 50.
        </li>
        <li>
          <strong>Policies and pages</strong>: longer text such as shipping,
          returns or opening hours. Up to 50.
        </li>
        <li>
          <strong>Documents</strong>: PDF or Word files, up to 10 MB each, up
          to 20. Text is read from them and indexed.
        </li>
        <li>
          <strong>Products</strong> (under <em>Products</em>): name, price, stock,
          description and image link, up to 200. The chatbot quotes prices from here,
          never guesses them.
        </li>
      </ul>

      <h2>How it works</h2>
      <p>
        After you save, the content is indexed in the background. Large
        documents take a little longer; the list shows when each item is
        ready. When a visitor asks something, the chatbot looks up the most
        relevant pieces of your content and answers from them. If nothing
        fits, it says it does not know and shows your contact option instead
        of making something up.
      </p>

      <h2>Tips</h2>
      <ul>
        <li>Write answers the way you would say them to a customer.</li>
        <li>Put one topic in each FAQ or page.</li>
        <li>
          Keep prices and policies in one place, and update them there when
          they change.
        </li>
        <li>
          Check <em>Unanswered</em> regularly: each question there is a gap in
          your knowledge.
        </li>
        <li>
          Do not upload documents with private customer data. Anything you add
          can be shown to visitors in an answer.
        </li>
      </ul>

      <p>
        Next: <DocLink href="/help/install">install the chat on your website</DocLink>.
      </p>
    </DocPage>
  );
}
