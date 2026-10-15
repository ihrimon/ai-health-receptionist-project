"use client";

import type { ChatbotConfig } from "@brainstack/shared";
import { useEffect, useState } from "react";
import { AppearanceTab } from "@/components/chatbot-editor/appearance-tab";
import { BehaviorTab } from "@/components/chatbot-editor/behavior-tab";
import { GeneralTab } from "@/components/chatbot-editor/general-tab";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ChatbotView, useChatbot } from "@/lib/chatbot";
import {
  checkDraft,
  type EditorTab,
  type FieldErrors,
  hasUnsavedEdits,
  tabForField,
} from "@/lib/config-form";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Chatbot settings (D-3 §3.2, M2-18), under Settings since /app/chatbot
 * became the test chat. Edits a local copy of the draft and saves it with
 * PUT /v1/chatbot/draft; nothing reaches visitors until it's published from
 * the header banner (M2-20).
 */
export default function ChatbotSettingsPage() {
  const { chatbot, error, refresh } = useChatbot();
  const [tab, setTab] = useState<EditorTab>("general");
  // Bumped after a save or revert, so the editor restarts from the server's draft.
  const [revision, setRevision] = useState(0);

  if (!chatbot) {
    return error ? (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your chatbot: {error}
        </p>
        <Button variant="outline" onClick={() => refresh().catch(() => {})}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Editor
      key={`${chatbot.id}:${revision}`}
      chatbot={chatbot}
      tab={tab}
      onTabChange={setTab}
      onReset={() => setRevision((n) => n + 1)}
    />
  );
}

function Editor({
  chatbot,
  tab,
  onTabChange,
  onReset,
}: {
  chatbot: ChatbotView;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  onReset: () => void;
}) {
  const { me } = useSession();
  const { saveDraft, discardDraft, setStatus } = useChatbot();
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const [draft, setDraft] = useState<ChatbotConfig>(chatbot.draftConfig);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const dirty = hasUnsavedEdits(chatbot.draftConfig, draft);

  // Warn before closing or reloading the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(change: (draft: ChatbotConfig) => void) {
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  }

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await action();
      toastSuccess(done);
      onReset();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    const check = checkDraft(draft);
    if (!check.ok) {
      setErrors(check.errors);
      onTabChange(tabForField(Object.keys(check.errors)[0]));
      toastError("Some fields need fixing before saving.");
      return;
    }
    setErrors({});
    void run(
      () => saveDraft(check.config),
      "Draft saved. Publish to make it live.",
    );
  }

  function handleRevert() {
    if (
      !window.confirm(
        "Throw away all unpublished changes and go back to the live settings?",
      )
    ) {
      return;
    }
    void run(discardDraft, "Back to the live settings.");
  }

  async function handleStatus(enabled: boolean) {
    try {
      await setStatus(enabled ? "ENABLED" : "DISABLED");
      toastSuccess(enabled ? "Chatbot turned on." : "Chatbot turned off.");
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  const tabProps = { draft, edit, errors };

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Chatbot settings</h2>
          <p className="text-sm text-muted-foreground">
            Changes are saved as a draft. Visitors see them after you publish.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={chatbot.status === "ENABLED"}
            disabled={!canEdit}
            onCheckedChange={(on) => void handleStatus(on)}
          />
          {chatbot.status === "ENABLED" ? "On" : "Off"}
        </label>
      </div>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as EditorTab)}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="behavior">Behavior</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        {/* A disabled fieldset makes the whole form read-only for viewers. */}
        <fieldset disabled={!canEdit || busy} className="min-w-0">
          <TabsContent value="general" className="grid gap-4">
            <GeneralTab {...tabProps} />
          </TabsContent>
          <TabsContent value="behavior" className="grid gap-4">
            <BehaviorTab {...tabProps} />
          </TabsContent>
          <TabsContent value="appearance" className="grid gap-4">
            <AppearanceTab {...tabProps} />
          </TabsContent>
        </fieldset>
      </Tabs>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {chatbot.publishedVersion && chatbot.hasUnpublishedChanges && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={handleRevert}
            >
              Revert to live settings
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button
            variant="outline"
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(chatbot.draftConfig);
              setErrors({});
            }}
          >
            Undo
          </Button>
          <Button disabled={!dirty || busy} onClick={handleSave}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You have view-only access. Ask an admin to change these settings.
        </p>
      )}
    </div>
  );
}
