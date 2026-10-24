"use client";

import { createTextSourceSchema } from "@brainstack/shared";
import { FileText, Plus, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TextField } from "@/components/chatbot-editor/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type KnowledgeSource,
  knowledgeApi,
  limitInfo,
  POLICY_TEMPLATES,
} from "@/lib/knowledge";
import { toastError, toastSuccess } from "@/lib/toast";
import { Markdown } from "./markdown";
import { ConfirmDelete, EmptyState, type TabBase, TabHeader } from "./shared";
import { StatusBadge } from "./status-badge";

type PageType = "POLICY" | "TEXT";

/** What the editor opens: an existing page, or a new one (maybe from a template). */
type Editing =
  | { id: string }
  | { id: null; type: PageType; title: string; content: string };

/**
 * Policies & info tab (D-3 §3.3): Markdown pages such as a return policy
 * or an "About us", each indexed for the bot after saving.
 */
export function PoliciesTab({
  pages,
  max,
  canEdit,
  onChanged,
}: TabBase & { pages: KnowledgeSource[]; max: number }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeSource | null>(null);
  const limit = limitInfo(pages.length, max);

  const startNew = (title = "", content = "") =>
    setEditing({ id: null, type: "POLICY", title, content });

  return (
    <div className="grid gap-4">
      <TabHeader
        title="Policies & info"
        description="Longer pages the bot reads to answer: delivery, returns, payments, about your business."
        limit={limit.label}
        action={
          canEdit && (
            <Button disabled={limit.full} onClick={() => startNew()}>
              <Plus /> New page
            </Button>
          )
        }
      />

      {canEdit && !limit.full && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Start from a template:</span>
          {POLICY_TEMPLATES.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant="outline"
              onClick={() => startNew(t.title, t.content)}
            >
              {t.title}
            </Button>
          ))}
        </div>
      )}

      {pages.length === 0 ? (
        <EmptyState
          title="No pages yet"
          example="Start with your return or delivery policy: customers ask about them most."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {pages.map((page) => (
            <li
              key={page.id}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setEditing({ id: page.id })}
              >
                <p className="truncate font-medium">{page.title}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {page.type === "POLICY" ? "Policy" : "Info"}
                  <StatusBadge status={page.status} />
                </p>
                {page.error && (
                  <p className="mt-1 text-xs text-destructive">{page.error}</p>
                )}
              </button>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  {page.status === "FAILED" && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Try indexing again"
                      onClick={() =>
                        knowledgeApi
                          .reindexSource(page.id)
                          .then(onChanged, (e: Error) => toastError(e.message))
                      }
                    >
                      <RotateCw />
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete"
                    onClick={() => setDeleting(page)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <PageEditor
          editing={editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
      <ConfirmDelete
        what={deleting ? `"${deleting.title}"` : null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await knowledgeApi.deleteSource(deleting!.id);
          await onChanged();
          toastSuccess("Page deleted.");
        }}
      />
    </div>
  );
}

function PageEditor({
  editing,
  canEdit,
  onClose,
  onSaved,
}: {
  editing: Editing;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = editing.id === null;
  const [type, setType] = useState<PageType>(isNew ? editing.type : "POLICY");
  const [title, setTitle] = useState(isNew ? editing.title : "");
  const [content, setContent] = useState(isNew ? editing.content : "");
  const [loaded, setLoaded] = useState(isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // The parent re-renders while polling statuses; a ref keeps that from
  // re-running the load below and wiping unsaved typing.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // An existing page's text isn't in the list; load it once.
  useEffect(() => {
    if (editing.id === null) return;
    knowledgeApi.getSource(editing.id).then(
      (page) => {
        setType(page.type === "TEXT" ? "TEXT" : "POLICY");
        setTitle(page.title);
        setContent(page.content ?? "");
        setLoaded(true);
      },
      (err: Error) => {
        toastError(err.message);
        closeRef.current();
      },
    );
  }, [editing.id]);

  async function save() {
    const check = createTextSourceSchema.safeParse({ type, title, content });
    if (!check.success) {
      setErrors(
        Object.fromEntries(
          check.error.issues.map((i) => [String(i.path[0]), i.message]),
        ),
      );
      return;
    }
    setBusy(true);
    try {
      if (editing.id === null) await knowledgeApi.createSource(check.data);
      else {
        await knowledgeApi.updateSource(editing.id, {
          title: check.data.title,
          content: check.data.content,
        });
      }
      await onSaved();
      toastSuccess("Saved. The bot will use it once it's indexed.");
      onClose();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const textarea = (
    <Textarea
      aria-label="Page content (Markdown)"
      className="h-80 resize-none overflow-y-auto font-mono text-sm"
      value={content}
      readOnly={!canEdit}
      onChange={(e) => setContent(e.target.value)}
    />
  );
  const preview = (
    <div className="h-80 overflow-y-auto rounded-lg border p-3">
      {content.trim() ? (
        <Markdown>{content}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New page" : "Edit page"}</DialogTitle>
        </DialogHeader>
        {!loaded ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <fieldset disabled={!canEdit || busy} className="grid min-w-0 gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <TextField
                label="Title"
                placeholder="Return policy"
                value={title}
                max={200}
                error={errors.title}
                onChange={setTitle}
              />
              {isNew && (
                <div className="grid gap-1.5">
                  <Label>Kind</Label>
                  <div className="flex gap-1">
                    {(["POLICY", "TEXT"] as const).map((t) => (
                      <Button
                        key={t}
                        type="button"
                        variant={type === t ? "default" : "outline"}
                        onClick={() => setType(t)}
                      >
                        {t === "POLICY" ? "Policy" : "Info"}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label>Content (Markdown: # Heading, - list, **bold**)</Label>
                <span className="text-xs text-muted-foreground">
                  {content.length} / 50,000
                </span>
              </div>
              {/* Side by side on wide screens, Write/Preview tabs on small ones. */}
              <div className="hidden gap-3 lg:grid lg:grid-cols-2">
                {textarea}
                {preview}
              </div>
              <Tabs defaultValue="write" className="lg:hidden">
                <TabsList>
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="write">{textarea}</TabsContent>
                <TabsContent value="preview">{preview}</TabsContent>
              </Tabs>
              {errors.content && (
                <p className="text-xs text-destructive">{errors.content}</p>
              )}
            </div>
          </fieldset>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button disabled={busy || !loaded} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
