import type { Metadata } from "next";
import { DocLink } from "@/components/doc-frame";
import { CONTACT_EMAIL, DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Privacy Policy | BrainStack" };

export default function PrivacyPage() {
  return (
    <DocPage
      title="Privacy Policy"
      intro="Last updated 18 October 2026. This explains what BrainStack AI Receptionist collects, why, and your choices."
    >
      <h2>Who is responsible</h2>
      <ul>
        <li>
          <strong>Companies that sign up</strong> (account holders): BrainStack
          is responsible for the account data described under &quot;Company
          accounts&quot;.
        </li>
        <li>
          <strong>Website visitors who chat</strong>: the company whose website
          you are on decides why your chat is kept and how it is used.
          BrainStack processes it on that company&apos;s behalf to run the
          chatbot. Please read that company&apos;s own privacy policy as well.
        </li>
      </ul>
      <p>
        Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>If you chat with a company&apos;s chatbot</h2>
      <p>What we handle:</p>
      <ul>
        <li>The messages you write and the answers you receive.</li>
        <li>
          Your name, email or phone number, only if you choose to type them
          into the chat (for example to leave a message for the company).
        </li>
        <li>
          The address of the page you were on, a random ID kept in your
          browser so your chat can continue, and your rating if you give one.
        </li>
        <li>
          Your IP address is used briefly to limit abuse (for example too many
          messages in a minute). It is not part of the saved conversation.
        </li>
      </ul>
      <p>
        Your messages are sent to an AI provider chosen by the company so it
        can produce the answer. The chat is saved so the company can read it,
        follow up and improve the chatbot. Please do not share passwords, card
        numbers or other sensitive information in the chat. The company can
        delete a conversation; ask the company directly to see or remove your
        data, or write to us and we will pass the request on.
      </p>

      <h2>Company accounts</h2>
      <ul>
        <li>
          <strong>Account data:</strong> your name, work email, a hashed
          password, your company name and your team members&apos; roles.
        </li>
        <li>
          <strong>Content you add:</strong> FAQs, policies, products, uploaded
          documents and chatbot settings.
        </li>
        <li>
          <strong>Use data:</strong> sign-in sessions (with IP address and
          browser type), counts of messages and AI usage, and security logs.
        </li>
        <li>
          <strong>Your AI provider key:</strong> stored encrypted and used only
          to answer on your behalf.
        </li>
      </ul>
      <p>We use this to provide and secure the service, to contact you about it (verification, password reset, new-lead alerts) and to fix problems. We do not sell personal data or use your content to train AI models.</p>

      <h2>Who else handles data</h2>
      <p>
        We use service providers to run the service: cloud hosting for the
        application and database, file storage for uploaded documents, email
        delivery, and the AI provider your company configured. They process
        data only to provide their service to us or to you.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep data while your workspace is active. Companies can delete
        individual conversations and leads at any time. If a workspace is
        closed, we delete its data on request, apart from backups that expire
        on their normal schedule and anything we must keep by law.
      </p>

      <h2>Security</h2>
      <p>
        Each company&apos;s data is kept separate from other companies&apos;,
        passwords are hashed, connections are encrypted, and access is limited
        to what is needed. No system is perfectly secure; tell us at once if
        you notice a problem.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live you may have the right to access, correct,
        delete or export your personal data, or to object to how it is used.
        Write to us at the address above, or to the company whose chatbot you
        used, and we will respond within a reasonable time.
      </p>

      <h2>Cookies</h2>
      <p>
        The dashboard uses a sign-in cookie that is needed to keep you logged
        in. The chat uses browser storage for the random visitor ID and chat
        state described above. We do not use advertising cookies.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy in an important way we will say so here and,
        for account holders, by email. See also our{" "}
        <DocLink href="/terms">Terms of Service</DocLink>.
      </p>
    </DocPage>
  );
}
