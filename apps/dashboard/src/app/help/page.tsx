import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Help | BrainStack" };

const ARTICLES = [
  {
    href: "/help/getting-started",
    title: "Getting started",
    description:
      "Create your account and have a working chatbot on your site in a few minutes.",
  },
  {
    href: "/help/knowledge",
    title: "Adding knowledge",
    description:
      "Teach the chatbot your FAQs, policies, products and documents, so it answers from your own content.",
  },
  {
    href: "/help/install",
    title: "Installing the chat on your website",
    description:
      "Add the one-line snippet, allow your domain and check that it works.",
  },
];

export default function HelpPage() {
  return (
    <DocPage
      title="Help"
      intro="Short guides for companies using BrainStack AI Receptionist."
    >
      <ul className="!ml-0 !space-y-3">
        {ARTICLES.map((a) => (
          <li key={a.href} className="!ml-0 !list-none !pl-0">
            <Link href={a.href} className="text-base font-semibold">
              {a.title}
            </Link>
            <p className="text-muted-foreground">{a.description}</p>
          </li>
        ))}
      </ul>
    </DocPage>
  );
}
