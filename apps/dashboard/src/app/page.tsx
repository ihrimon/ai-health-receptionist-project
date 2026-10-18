import Link from "next/link";
import {
  BookOpen,
  Code,
  MessageCircle,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Interim landing page for the platform branch (M1). The full marketing
// page comes in M7 (docs/design/d3-screens.md §1.1).
const FEATURES = [
  {
    icon: Code,
    title: "One line to install",
    description:
      "Paste a single script tag into your site — Shopify, WooCommerce or plain HTML — and the chat widget appears.",
  },
  {
    icon: BookOpen,
    title: "Answers from your own content",
    description:
      "Add your products, FAQs and policies. The assistant answers from them and never makes up prices or policies.",
  },
  {
    icon: UserPlus,
    title: "Turns visitors into leads",
    description:
      "Interested visitors leave their contact details, and you get notified right away.",
  },
  {
    icon: Sparkles,
    title: "Available 24/7",
    description:
      "Visitors get instant answers any time of day, even when your team is offline.",
  },
];

export default function HomePage() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-6 py-16 text-center sm:py-20">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <MessageCircle className="size-7" />
        </div>

        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          BrainStack AI Receptionist
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted-foreground">
          An AI assistant for your website that knows your products, services
          and policies, answers visitors in seconds, and captures leads while
          you sleep.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            nativeButton={false}
            className="rounded-full px-8 text-base"
            render={<Link href="/signup">Get started</Link>}
          />
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title} className="text-left">
              <CardContent className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-primary/20">
                  <f.icon className="size-4.5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{f.title}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {f.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-4 text-center text-muted-foreground/70">
        <Link href="/login" className="hover:text-muted-foreground">
          Sign in
        </Link>
        <Link href="/help" className="hover:text-muted-foreground">
          Help
        </Link>
        <Link href="/terms" className="hover:text-muted-foreground">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-muted-foreground">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
