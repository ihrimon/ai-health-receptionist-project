"use client";

import { createCustomAnswerSchema } from "@brainstack/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  TextAreaField,
  TextField,
} from "@/components/chatbot-editor/fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type CustomAnswer, knowledgeApi, limitInfo } from "@/lib/knowledge";
import { toastError, toastSuccess } from "@/lib/toast";
import { ConfirmDelete, EmptyState, type TabBase, TabHeader } from "./shared";

/**
 * Custom answers tab (D-3 §3.3): "when asked something like X, reply with
 * exactly Y", checked before anything else (requirements §9.1).
 */
export function CustomAnswersTab({
  answers,
  max,
  canEdit,
  onChanged,
}: TabBase & { answers: CustomAnswer[]; max: number }) {
  const [editing, setEditing] = useState<CustomAnswer | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomAnswer | null>(null);
  const limit = limitInfo(answers.length, max);

  async function toggle(answer: CustomAnswer, isActive: boolean) {
    try {
      await knowledgeApi.updateCustomAnswer(answer.id, { isActive });
      await onChanged();
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  return (
    <div className="grid gap-4">
      <TabHeader
        title="Custom answers"
        description="When a visitor asks something like this, the bot replies with exactly your answer. Use it for answers that must be word for word."
        limit={limit.label}
        action={
          canEdit && (
            <Button disabled={limit.full} onClick={() => setEditing("new")}>
              <Plus /> Add answer
            </Button>
          )
        }
      />

      {answers.length === 0 ? (
        <EmptyState
          title="No custom answers yet"
          example='For example: "Who owns the shop?" → "Stride Shoes is run by Rina Ahmed since 2015."'
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When asked</TableHead>
                <TableHead>Reply with</TableHead>
                <TableHead className="w-16">On</TableHead>
                {canEdit && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {answers.map((answer) => (
                <TableRow key={answer.id}>
                  <TableCell className="max-w-48 font-medium whitespace-normal">
                    {answer.triggerQuestion}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-muted-foreground">
                    <span className="line-clamp-2">{answer.answer}</span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={answer.isActive}
                      disabled={!canEdit}
                      aria-label="Answer is on"
                      onCheckedChange={(on) => void toggle(answer, on)}
                    />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => setEditing(answer)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete"
                          onClick={() => setDeleting(answer)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <AnswerDialog
          answer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
      <ConfirmDelete
        what={deleting ? "this custom answer" : null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await knowledgeApi.deleteCustomAnswer(deleting!.id);
          await onChanged();
          toastSuccess("Custom answer deleted.");
        }}
      />
    </div>
  );
}

function AnswerDialog({
  answer,
  onClose,
  onSaved,
}: {
  answer: CustomAnswer | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [triggerQuestion, setTrigger] = useState(answer?.triggerQuestion ?? "");
  const [reply, setReply] = useState(answer?.answer ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const check = createCustomAnswerSchema.safeParse({
      triggerQuestion,
      answer: reply,
      isActive: answer?.isActive ?? true,
    });
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
      if (answer) {
        await knowledgeApi.updateCustomAnswer(answer.id, {
          triggerQuestion: check.data.triggerQuestion,
          answer: check.data.answer,
        });
      } else {
        await knowledgeApi.createCustomAnswer(check.data);
      }
      await onSaved();
      toastSuccess(answer ? "Custom answer updated." : "Custom answer added.");
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
          <DialogTitle>{answer ? "Edit custom answer" : "Add custom answer"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <TextField
            label="When a visitor asks something like"
            placeholder="Who owns the shop?"
            value={triggerQuestion}
            max={500}
            error={errors.triggerQuestion}
            onChange={setTrigger}
          />
          <TextAreaField
            label="Reply with exactly"
            value={reply}
            max={4000}
            rows={4}
            error={errors.answer}
            onChange={setReply}
          />
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
