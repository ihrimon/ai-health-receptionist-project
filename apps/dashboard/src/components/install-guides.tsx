"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  INSTALL_GUIDES,
  splitInlineCode,
  type InstallCode,
} from "@/lib/install-guides";
import {
  nextLayoutCode,
  nextPagesCode,
  parseSnippet,
  reactComponentCode,
  type SnippetParts,
} from "@/lib/install-snippet";
import { toastError } from "@/lib/toast";

function Rich({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((part, i) =>
        part.code ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** The company's snippet (or other code) with a copy button (Install page, M4-13). */
export function SnippetBlock({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError("Couldn't copy. Select the code and copy it yourself.");
    }
  }

  return (
    <div className="grid gap-2">
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">
        <code>{snippet}</code>
      </pre>
      <Button variant="outline" className="w-fit" onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
}

function codeFor(kind: InstallCode, parts: SnippetParts): string {
  switch (kind) {
    case "next-layout":
      return nextLayoutCode(parts);
    case "next-pages":
      return nextPagesCode(parts);
    case "react-component":
      return reactComponentCode(parts);
  }
}

/** Per-platform steps for pasting the snippet (FR-3.3, M4-15). */
export function InstallGuides({ snippet }: { snippet: string }) {
  const parts = parseSnippet(snippet);
  return (
    <Tabs defaultValue={INSTALL_GUIDES[0].id}>
      <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
        {INSTALL_GUIDES.map((g) => (
          <TabsTrigger key={g.id} value={g.id}>
            {g.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {INSTALL_GUIDES.map((g) => (
        <TabsContent key={g.id} value={g.id} className="grid gap-4 pt-2">
          <p className="text-muted-foreground">{g.intro}</p>
          <ol className="grid gap-3">
            {g.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {i + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-2 pt-0.5">
                  <p>
                    <Rich text={step.text} />
                  </p>
                  {step.snippet && <SnippetBlock snippet={snippet} />}
                  {step.code && parts && (
                    <SnippetBlock snippet={codeFor(step.code, parts)} />
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="grid gap-1 rounded-lg border p-3 text-muted-foreground">
            <p className="font-medium text-foreground">Good to know</p>
            <ul className="grid list-disc gap-1 pl-5">
              {g.tips.map((tip) => (
                <li key={tip}>
                  <Rich text={tip} />
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
