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

interface Lists {
  faqs: Faq[];
  customAnswers: CustomAnswer[];
  sources: KnowledgeSource[];
}

const loadAll = async (): Promise<Lists> => {
  const [faqs, customAnswers, sources] = await Promise.all([
    knowledgeApi.listFaqs(),
    knowledgeApi.listCustomAnswers(),
    knowledgeApi.listSources(),
  ]);
  return { faqs, customAnswers, sources };
};

/**
 * Knowledge base (D-3 §3.3, M2-19): FAQs, policy/info pages, custom
 * answers and documents. Every change is live at once (only the chatbot
 * settings have a draft); the publish banner refreshes, since the first
 * FAQ or policy is what makes publishing possible.
 */
export default function KnowledgePage() {
  const { me } = useSession();
  const { refresh: refreshChatbot } = useChatbot();
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadAll().then(
      (loaded) => !cancelled && setLists(loaded),
      (err: unknown) => !cancelled && setError((err as Error).message),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, me.activeWorkspace?.id]);

  /** Reloads after a change, and lets the banner re-check publishing. */
  const changed = useCallback(async () => {
    setLists(await loadAll());
    await refreshChatbot().catch(() => {});
  }, [refreshChatbot]);

  /** A stored document appears in the list at once, before the next upload starts. */
  const addSource = useCallback(
    (source: KnowledgeSource) =>
      setLists((l) =>
        l && !l.sources.some((s) => s.id === source.id)
          ? { ...l, sources: [...l.sources, source] }
          : l,
      ),
    [],
  );

  // While a source is being indexed, check its status: every 3 s at first,
  // slower while nothing changes, and not at all while the tab is hidden.
  const polling = lists ? needsPolling(lists.sources) : false;
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
        .then((sources) => {
          if (cancelled) return;
          const now = statusSignature(sources);
          unchanged = now === last ? unchanged + 1 : 0;
          last = now;
          setLists((l) => (l ? { ...l, sources } : l));
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

  if (!lists) {
    return error ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
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
    ) : (
      <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const pages = lists.sources.filter((s) => s.type === "POLICY" || s.type === "TEXT");
  const documents = lists.sources.filter((s) => s.type === "DOCUMENT");

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Knowledge</h2>
        <p className="text-sm text-muted-foreground">
          What your chatbot answers from. Changes here are live right away.
        </p>
      </div>

      <Tabs defaultValue="faqs">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="faqs">FAQs ({lists.faqs.length})</TabsTrigger>
          <TabsTrigger value="pages">Policies &amp; info ({pages.length})</TabsTrigger>
          <TabsTrigger value="custom">
            Custom answers ({lists.customAnswers.length})
          </TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="faqs">
          <FaqsTab
            faqs={lists.faqs}
            max={KNOWLEDGE_LIMITS.faqs}
            canEdit={canEdit}
            onChanged={changed}
          />
        </TabsContent>
        <TabsContent value="pages">
          <PoliciesTab
            pages={pages}
            max={KNOWLEDGE_LIMITS.textSources}
            canEdit={canEdit}
            onChanged={changed}
          />
        </TabsContent>
        <TabsContent value="custom">
          <CustomAnswersTab
            answers={lists.customAnswers}
            max={KNOWLEDGE_LIMITS.customAnswers}
            canEdit={canEdit}
            onChanged={changed}
          />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab
            documents={documents}
            canEdit={canEdit}
            onChanged={changed}
            onUploaded={addSource}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
