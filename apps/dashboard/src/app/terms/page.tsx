import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Terms of Service | BrainStack" };

export default function TermsPage() {
  return (
    <DocPage
      title="Terms of Service"
      intro="Last updated 18 October 2026. These terms apply to companies using BrainStack AI Receptionist (the service)."
    >
      <h2>1. Who we are and who these terms are with</h2>
      <p>
        The service is provided by BrainStack (&quot;we&quot;, &quot;us&quot;).
        By creating an account you agree to these terms on behalf of your
        company (&quot;you&quot;), and confirm you are allowed to do so.
        Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>2. The service</h2>
      <p>
        The service lets you set up an AI chatbot, give it your own content
        (FAQs, policies, products, documents) and show it on your website.
        The chatbot is powered by an AI provider account that you supply, and
        you pay that provider directly. During the beta we may change, limit
        or remove features, and we may set usage limits such as the number of
        messages per day.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>Give accurate details and keep your password secret.</li>
        <li>
          You are responsible for what happens under your account, including
          the people you invite to your workspace.
        </li>
        <li>Tell us quickly if you think your account was accessed by someone else.</li>
      </ul>

      <h2>4. Your content and your visitors</h2>
      <ul>
        <li>
          You keep all rights to the content you add. You give us permission
          to store, process and display it only to run the service for you.
        </li>
        <li>
          You are responsible for your content and for having the right to use
          it. Do not upload content that is unlawful, infringing, or contains
          other people&apos;s private data without a lawful reason.
        </li>
        <li>
          You are responsible for telling your website visitors how their chat
          is used and for having a lawful basis to handle their data. The chat
          shows a short notice and a link to our{" "}
          <Link href="/privacy">Privacy Policy</Link>; you should also cover it
          in your own privacy policy. For visitor data, you decide why and how
          it is used and we process it on your behalf.
        </li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the service to break the law or to harm, harass or deceive people;</li>
        <li>
          present the chatbot as a human, or use it for medical, legal or
          financial advice that people may rely on without checking;
        </li>
        <li>
          attack, overload or probe the service, bypass its limits, or access
          another company&apos;s data;
        </li>
        <li>resell the service or copy it, except as these terms allow.</li>
      </ul>

      <h2>6. AI answers</h2>
      <p>
        The chatbot is designed to answer from your content, but AI can be
        wrong. We do not guarantee that any answer is accurate or complete.
        You are responsible for checking that your content is correct and for
        how you use the answers.
      </p>

      <h2>7. Availability, beta</h2>
      <p>
        The service is in beta and is provided &quot;as is&quot;. We aim for
        it to be reliable but do not promise uninterrupted service. We may
        suspend an account that breaks these terms or puts the service or
        others at risk.
      </p>

      <h2>8. Fees</h2>
      <p>
        The beta is free of charge. If we introduce paid plans, we will tell
        you in advance and you may stop using the service instead. Your AI
        provider charges you separately.
      </p>

      <h2>9. Ending your use</h2>
      <p>
        You can stop at any time and ask us to delete your workspace and its
        data by writing to us. We may end or suspend the service with
        reasonable notice, except where we must act immediately.
      </p>

      <h2>10. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or
        consequential loss, lost profits or lost data, and our total liability
        for any claim is limited to the fees you paid us in the 12 months
        before it (zero during the free beta). Nothing in these terms limits
        liability that cannot be limited by law.
      </p>

      <h2>11. Changes and governing law</h2>
      <p>
        We may update these terms; for important changes we will notify you
        by email or in the service before they apply, and continued use
        afterwards means you accept them. These terms are governed by the laws
        of the country where BrainStack is established, and its courts have
        jurisdiction, unless your local mandatory law says otherwise.
      </p>
    </DocPage>
  );
}
