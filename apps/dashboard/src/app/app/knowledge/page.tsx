"use client";

import { KNOWLEDGE_LIMITS } from "@brainstack/shared";
import { useCallback, useEffect, useState } from "react";
import { CustomAnswersTab } from "@/components/knowledge/custom-answers-tab";
import { DocumentsTab } from "@/components/knowledge/documents-tab";
import { FaqsTab } from "@/components/knowledge/faqs-tab";
import { PoliciesTab } from "@/components/knowledge/policies-tab";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatbot } from "@/lib/chatbot";
import {
  type CustomAnswer,
  type Faq,
  type KnowledgeSource,
  knowledgeApi,
  needsPolling,
  pollDelay,
  statusSignature,
} from "@/lib/knowledge";
import { useSession } from "@/lib/session";

type TabId = "faqs" | "pages" | "custom" | "documents";

/** Policies & info and Documents are both read from the sources list. */
const listOf = (tab: TabId) =>
  tab === "faqs" ? "faqs" : tab === "custom" ? "custom" : "sources";

/**
 * Knowledge base (D-3 §3.3, M2-19): FAQs, policy/info pages, custom
 * answers and documents. Every change is live at once (only the chatbot
 * settings have a draft); the publish banner refreshes, since the first
 * FAQ or policy is what makes publishing possible.
 *
 * Only the open tab's list is loaded (the others when the tab is first
 * opened), so the page starts with one request instead of three.
 */
export default function KnowledgePage() {
  const { me } = useSession();
  // A new workspace starts again from the first tab.
  return <KnowledgeView key={me.activeWorkspace?.id} />;
}

function KnowledgeView() {
  const { me } = useSession();
  const { refresh: refreshChatbot } = useChatbot();
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const [tab, setTab] = useState<TabId>("faqs");
  const [faqs, setFaqs] = useState<Faq[] | null>(null);
  const [customAnswers, setCustomAnswers] = useState<CustomAnswer[] | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const list = listOf(tab);
  const loaded =
    list === "faqs" ? faqs !== null : list === "custom" ? customAnswers !== null : sources !== null;

  /** (Re)loads the list behind a tab. */
  const load = useCallback(
    (which: ReturnType<typeof listOf>): Promise<void> =>
      which === "faqs"
        ? knowledgeApi.listFaqs().then(setFaqs)
        : which === "custom"
          ? knowledgeApi.listCustomAnswers().then(setCustomAnswers)
          : knowledgeApi.listSources().then(setSources),
    [],
  );

  // Load the open tab's list the first time it is needed (or on "Try again").
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    load(list).catch((err: unknown) => {
      if (!cancelled) setError((err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [list, loaded, load, attempt]);

  /** Reloads the open tab after a change, and lets the banner re-check publishing. */
  const changed = useCallback(async () => {
    await load(list);
    await refreshChatbot().catch(() => {});
  }, [load, list, refreshChatbot]);

  /** A stored document appears in the list at once, before the next upload starts. */
  const addSource = useCallback(
    (source: KnowledgeSource) =>
      setSources((s) =>
        s && !s.some((x) => x.id === source.id) ? [...s, source] : s,
      ),
    [],
  );

  // While a source is being indexed, check its status: every 3 s at first,
  // slower while nothing changes, and not at all while the tab is hidden.
  const polling = sources ? needsPolling(sources) : false;
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let unchanged = 0;
    let last = "";
    const check = () => {
      if (document.hidden) {
        timer = setTimeout(check, pollDelay(unchanged));
        return;
      }
      knowledgeApi
        .listSources()
        .then((next) => {
          if (cancelled) return;
          const now = statusSignature(next);
          unchanged = now === last ? unchanged + 1 : 0;
          last = now;
          setSources(next);
        })
        .catch(() => {
          unchanged += 1;
        })
        .finally(() => {
          if (!cancelled) timer = setTimeout(check, pollDelay(unchanged));
        });
    };
    timer = setTimeout(check, pollDelay(0));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling]);

  const pages = sources?.filter((s) => s.type === "POLICY" || s.type === "TEXT");
  const documents = sources?.filter((s) => s.type === "DOCUMENT");
  /** Tab titles show a count once that list has been loaded. */
  const count = (n: number | undefined) => (n === undefined ? "" : ` (${n})`);

  const loading = (
    <div className="grid gap-4 py-2">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
  const failed = error && !loaded && (
    <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load your knowledge base: {error}
      </p>
      <Button
        variant="outline"
        onClick={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      >
        Try again
      </Button>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Knowledge</h2>
        <p className="text-sm text-muted-foreground">
          What your chatbot answers from. Changes here are live right away.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(next) => {
          setError(null);
          setTab(next as TabId);
        }}
      >
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="faqs">FAQs{count(faqs?.length)}</TabsTrigger>
          <TabsTrigger value="pages">Policies &amp; info{count(pages?.length)}</TabsTrigger>
          <TabsTrigger value="custom">
            Custom answers{count(customAnswers?.length)}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents{count(documents?.length)}</TabsTrigger>
        </TabsList>
        <TabsContent value="faqs">
          {faqs ? (
            <FaqsTab
              faqs={faqs}
              max={KNOWLEDGE_LIMITS.faqs}
              canEdit={canEdit}
              onChanged={changed}
            />
          ) : (
            (failed ?? loading)
          )}
        </TabsContent>
        <TabsContent value="pages">
          {pages ? (
            <PoliciesTab
              pages={pages}
              max={KNOWLEDGE_LIMITS.textSources}
              canEdit={canEdit}
              onChanged={changed}
            />
          ) : (
            (failed ?? loading)
          )}
        </TabsContent>
        <TabsContent value="custom">
          {customAnswers ? (
            <CustomAnswersTab
              answers={customAnswers}
              max={KNOWLEDGE_LIMITS.customAnswers}
              canEdit={canEdit}
              onChanged={changed}
            />
          ) : (
            (failed ?? loading)
          )}
        </TabsContent>
        <TabsContent value="documents">
          {documents ? (
            <DocumentsTab
              documents={documents}
              canEdit={canEdit}
              onChanged={changed}
              onUploaded={addSource}
            />
          ) : (
            (failed ?? loading)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
