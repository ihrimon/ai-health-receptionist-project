"use client";

import { createFaqSchema } from "@brainstack/shared";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { TextAreaField, TextField } from "@/components/chatbot-editor/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type Faq,
  filterFaqs,
  knowledgeApi,
  limitInfo,
  moveItem,
} from "@/lib/knowledge";
import { toastError, toastSuccess } from "@/lib/toast";
import { ConfirmDelete, EmptyState, type TabBase, TabHeader } from "./shared";

/** FAQs tab (D-3 §3.3): question/answer pairs, in display order. */
export function FaqsTab({
  faqs,
  max,
  canEdit,
  onChanged,
}: TabBase & { faqs: Faq[]; max: number }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Faq | "new" | null>(null);
  const [deleting, setDeleting] = useState<Faq | null>(null);
  const [moving, setMoving] = useState(false);
  const limit = limitInfo(faqs.length, max);
  const shown = filterFaqs(faqs, query);

  async function move(index: number, by: -1 | 1) {
    const ids = moveItem(faqs.map((f) => f.id), index, by);
    setMoving(true);
    try {
      await knowledgeApi.reorderFaqs(ids);
      await onChanged();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <TabHeader
        title="FAQs"
        description="Questions customers often ask, with your answer. The bot uses them to answer similar questions."
        limit={limit.label}
        action={
          canEdit && (
            <Button disabled={limit.full} onClick={() => setEditing("new")}>
              <Plus /> Add FAQ
            </Button>
          )
        }
      />

      {faqs.length > 3 && (
        <div className="relative max-w-xs">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search FAQs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {faqs.length === 0 ? (
        <EmptyState
          title="No FAQs yet"
          example='For example: "Do you deliver outside Dhaka?" → "Yes, in 3–5 days for 120 taka."'
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map((faq) => {
            const index = faqs.indexOf(faq);
            return (
              <li key={faq.id} className="flex gap-3 p-3">
                {canEdit && !query && (
                  <div className="flex flex-col">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={moving || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={moving || index === faqs.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{faq.question}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
                    {faq.answer}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Edit"
                      onClick={() => setEditing(faq)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => setDeleting(faq)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">
              No FAQ matches &ldquo;{query}&rdquo;.
            </li>
          )}
        </ul>
      )}

      {editing && (
        <FaqDialog
          faq={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
      <ConfirmDelete
        what={deleting ? "this FAQ" : null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await knowledgeApi.deleteFaq(deleting!.id);
          await onChanged();
          toastSuccess("FAQ deleted.");
        }}
      />
    </div>
  );
}

function FaqDialog({
  faq,
  onClose,
  onSaved,
}: {
  faq: Faq | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [question, setQuestion] = useState(faq?.question ?? "");
  const [answer, setAnswer] = useState(faq?.answer ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const check = createFaqSchema.safeParse({ question, answer });
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
      if (faq) await knowledgeApi.updateFaq(faq.id, check.data);
      else await knowledgeApi.createFaq(check.data);
      await onSaved();
      toastSuccess(faq ? "FAQ updated." : "FAQ added.");
      onClose();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{faq ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <TextField
            label="Question"
            placeholder="Do you deliver outside Dhaka?"
            value={question}
            max={500}
            error={errors.question}
            onChange={setQuestion}
          />
          <TextAreaField
            label="Answer"
            value={answer}
            max={4000}
            rows={5}
            error={errors.answer}
            onChange={setAnswer}
          />
          <p className="text-xs text-muted-foreground">
            Saved FAQs are live right away.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
