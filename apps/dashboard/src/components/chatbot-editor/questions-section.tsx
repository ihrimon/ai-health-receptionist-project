"use client";

import type { QuestionToAsk } from "@brainstack/shared";
import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MAX_QUESTIONS, newQuestion } from "@/lib/config-form";
import { Field, TextField } from "./fields";
import type { TabProps } from "./general-tab";
import { Section } from "./section";

const FIELD_ITEMS = [
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "custom", label: "Other answer" },
] satisfies { value: QuestionToAsk["field"]; label: string }[];

const ASK_WHEN_ITEMS = [
  { value: "conversation_start", label: "Early in the chat" },
  { value: "before_recommendation", label: "Before recommending a product" },
  { value: "on_purchase_intent", label: "When the visitor wants to buy" },
] satisfies { value: QuestionToAsk["askWhen"]; label: string }[];

const PLACEHOLDER: Record<QuestionToAsk["field"], string> = {
  name: "May I have your name?",
  email: "What's your email, so we can send you the details?",
  phone: "What's a good phone number to reach you?",
  custom: "What's your budget?",
};

/**
 * "Questions to ask" (FR-2.9, M5-4): what the bot asks visitors and when.
 * The answers are saved as a lead (Leads page); the dashboard Test chat
 * doesn't save them.
 */
export function QuestionsSection({ draft, edit, errors }: TabProps) {
  const questions = draft.behavior.questionsToAsk;
  const listError = errors["behavior.questionsToAsk"];
  return (
    <Section
      title="Questions to ask"
      description="The bot asks these at the right moment, one at a time, and saves the answers as a lead. Test chat answers are not saved."
    >
      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No questions yet. Add one to start collecting leads, for example the
          visitor&apos;s phone number when they want to buy.
        </p>
      )}
      {questions.map((question, index) => (
        <QuestionRow
          key={question.id}
          question={question}
          index={index}
          errors={errors}
          edit={edit}
        />
      ))}
      {listError && <p className="text-xs text-destructive">{listError}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {questions.length} / {MAX_QUESTIONS}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={questions.length >= MAX_QUESTIONS}
          onClick={() =>
            edit((d) => {
              d.behavior.questionsToAsk.push(
                newQuestion(d.behavior.questionsToAsk),
              );
            })
          }
        >
          <Plus />
          Add question
        </Button>
      </div>
    </Section>
  );
}

function QuestionRow({
  question,
  index,
  errors,
  edit,
}: {
  question: QuestionToAsk;
  index: number;
} & Pick<TabProps, "errors" | "edit">) {
  const requiredId = useId();
  const path = `behavior.questionsToAsk.${index}`;
  const update = (change: (q: QuestionToAsk) => void) =>
    edit((d) => {
      const target = d.behavior.questionsToAsk.find(
        (q) => q.id === question.id,
      );
      if (target) change(target);
    });

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label={`Question ${index + 1}`}
            placeholder={PLACEHOLDER[question.field]}
            value={question.question}
            max={200}
            error={errors[`${path}.question`]}
            onChange={(v) => update((q) => void (q.question = v))}
          />
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="mt-6"
          aria-label={`Remove question ${index + 1}`}
          onClick={() =>
            edit((d) => {
              d.behavior.questionsToAsk = d.behavior.questionsToAsk.filter(
                (q) => q.id !== question.id,
              );
            })
          }
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Saved as">
          <Select
            items={FIELD_ITEMS}
            value={question.field}
            onValueChange={(v) =>
              update((q) => void (q.field = v as QuestionToAsk["field"]))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="When to ask">
          <Select
            items={ASK_WHEN_ITEMS}
            value={question.askWhen}
            onValueChange={(v) =>
              update((q) => void (q.askWhen = v as QuestionToAsk["askWhen"]))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASK_WHEN_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <label
        htmlFor={requiredId}
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Switch
          id={requiredId}
          checked={question.required}
          onCheckedChange={(on) => update((q) => void (q.required = on))}
        />
        Important: the bot makes sure to ask it (visitors can still say no)
      </label>
    </div>
  );
}
