"use client";

import { Check, CircleAlert, CircleCheck, Clock, Copy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AllowedDomainsEditor } from "@/components/allowed-domains-editor";
import { useChatbot } from "@/lib/chatbot";
import { installStatus } from "@/lib/install-status";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";
import { useAiKeyReady } from "@/lib/use-ai-key-ready";

/**
 * Settings → Install (M4-13, D-3 §3.5): the sites allowed to show the chat,
 * the one-line snippet that puts it there, and what must be true for it to
 * answer, and whether the chat has shown up on the site yet (M4-14).
 */
export default function InstallPage() {
  const { me } = useSession();
  const { chatbot, refresh } = useChatbot();
  const aiKeyReady = useAiKeyReady();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  // The install is recorded by the API when the chat first loads on the
  // site, so the status loaded with the dashboard may be old.
  useEffect(() => {
    refresh().catch(() => {});
    // Once per visit to this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!chatbot || aiKeyReady === undefined) {
    return <Skeleton className="h-64 w-full" />;
  }

  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const checks = [
    {
      ok: chatbot.allowedDomains.length > 0,
      text: "Website domain added",
      fix: "Add it under Allowed domains above.",
    },
    {
      ok: chatbot.publishedVersion !== null,
      text: "Published",
      fix: "Publish from the banner at the top of the page.",
    },
    {
      ok: chatbot.status === "ENABLED",
      text: "Switched on",
      fix: "Turn it on in Settings → Chatbot.",
    },
    // null: only the owner can see keys.
    ...(aiKeyReady === null
      ? []
      : [
          {
            ok: aiKeyReady,
            text: "AI key added",
            fix: "Add one in Settings → AI.",
          },
        ]),
  ];

  const status = installStatus(
    chatbot.installVerifiedAt,
    chatbot.installVerifiedHost,
  );

  async function checkAgain() {
    setChecking(true);
    try {
      await refresh();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(chatbot!.embedSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError("Couldn't copy. Select the code and copy it yourself.");
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status.installed ? (
              <CircleCheck className="size-5 text-emerald-600" />
            ) : (
              <Clock className="size-5 text-muted-foreground" />
            )}
            {status.title}
          </CardTitle>
          <CardDescription>{status.detail}</CardDescription>
        </CardHeader>
        {!status.installed && (
          <CardContent>
            <Button
              variant="outline"
              className="w-fit"
              disabled={checking}
              onClick={() => void checkAgain()}
            >
              <RefreshCw className={checking ? "animate-spin" : undefined} />
              Check again
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>1. Allowed domains</CardTitle>
          <CardDescription>
            The chat only loads on these websites, so nobody can put your bot
            on theirs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AllowedDomainsEditor canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Add the chat to your website</CardTitle>
          <CardDescription>
            Paste this line just before <code>&lt;/body&gt;</code> on every
            page where the chat should appear. A chat button shows up in the
            corner.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">
            <code>{chatbot.embedSnippet}</code>
          </pre>
          <Button variant="outline" className="w-fit" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy code"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Does the chat button cover something at the bottom of your site?
            Add <code>data-bottom=&quot;96&quot;</code> to the tag to lift it
            96 pixels from the bottom.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Before it can answer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {checks.map((c) => (
            <div key={c.text} className="flex items-start gap-2">
              {c.ok ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <span>
                {c.text}
                {!c.ok && <span className="text-muted-foreground"> · {c.fix}</span>}
              </span>
            </div>
          ))}
          <p className="pt-2 text-muted-foreground">
            Visitors see the published settings. Want to try it first?{" "}
            <Link href="/app/chatbot" className="underline underline-offset-4">
              Chat with it here
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
