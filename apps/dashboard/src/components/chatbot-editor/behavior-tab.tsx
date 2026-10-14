"use client";

import { HANDOFF_TYPES, TONES, type Tone } from "@brainstack/shared";
import { cn } from "cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChipInput, Field, TextAreaField, TextField } from "./fields";
import type { TabProps } from "./general-tab";
import { Section } from "./section";

const TONE_INFO: Record<Tone, { label: string; description: string }> = {
  friendly: { label: "Friendly", description: "Warm and relaxed, like a helpful shop assistant." },
  professional: { label: "Professional", description: "Polite, clear and to the point." },
  casual: { label: "Casual", description: "Chatty and informal." },
};

const HANDOFF_ITEMS = [
  { value: "none", label: "No contact button" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "url", label: "Web page (link)" },
] satisfies { value: (typeof HANDOFF_TYPES)[number]; label: string }[];

const HANDOFF_PLACEHOLDER: Record<string, string> = {
  email: "support@shop.example.com",
  phone: "+880 1711 000000",
  whatsapp: "+880 1711 000000",
  url: "https://shop.example.com/contact",
};

/** Behavior tab (D-3 §3.2): how the bot talks and what it avoids. */
export function BehaviorTab({ draft, edit, errors }: TabProps) {
  const { behavior } = draft;
  const handoff = behavior.handoff;
  return (
    <>
      <Section title="Tone">
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              role="radio"
              aria-checked={behavior.tone === tone}
              onClick={() => edit((d) => void (d.behavior.tone = tone))}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-60",
                behavior.tone === tone && "border-primary ring-1 ring-primary",
              )}
            >
              <span className="font-medium">{TONE_INFO[tone].label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {TONE_INFO[tone].description}
              </span>
            </button>
          ))}
        </div>
        <TextField
          label="Extra tone note (optional)"
          placeholder="Use short sentences, no emojis"
          value={behavior.customToneNote}
          max={200}
          error={errors["behavior.customToneNote"]}
          onChange={(v) => edit((d) => void (d.behavior.customToneNote = v))}
        />
      </Section>

      <Section
        title="Instructions"
        description="Anything the bot should always do or know, in your own words."
      >
        <TextAreaField
          label="Instructions"
          placeholder="Always mention free delivery on orders over 3,000 taka. Recommend our sale page when asked about discounts."
          value={behavior.instructions}
          max={2000}
          rows={6}
          error={errors["behavior.instructions"]}
          onChange={(v) => edit((d) => void (d.behavior.instructions = v))}
        />
      </Section>

      <Section title="Topics">
        <ChipInput
          label="Talk about only (optional)"
          hint="Leave empty to allow anything about your business."
          placeholder="e.g. shoes, delivery"
          values={behavior.allowedTopics}
          max={20}
          maxLength={80}
          error={errors["behavior.allowedTopics"]}
          onChange={(v) => edit((d) => void (d.behavior.allowedTopics = v))}
        />
        <ChipInput
          label="Never talk about"
          placeholder="e.g. competitor prices, medical advice"
          values={behavior.avoidedTopics}
          max={20}
          maxLength={80}
          error={errors["behavior.avoidedTopics"]}
          onChange={(v) => edit((d) => void (d.behavior.avoidedTopics = v))}
        />
      </Section>

      <Section
        title="When the bot doesn't know"
        description="What it says when your knowledge base has no answer, and how visitors can reach a person."
      >
        <TextAreaField
          label="Fallback message"
          value={behavior.fallbackMessage}
          max={500}
          rows={2}
          error={errors["behavior.fallbackMessage"]}
          onChange={(v) => edit((d) => void (d.behavior.fallbackMessage = v))}
        />
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Contact button">
            <Select
              items={HANDOFF_ITEMS}
              value={handoff.type}
              onValueChange={(type) =>
                edit((d) => {
                  d.behavior.handoff.type = type as typeof handoff.type;
                  if (type === "none") {
                    d.behavior.handoff.value = null;
                    d.behavior.handoff.label = null;
                  }
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HANDOFF_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {handoff.type !== "none" && (
            <TextField
              label="Where it goes"
              placeholder={HANDOFF_PLACEHOLDER[handoff.type]}
              value={handoff.value}
              error={errors["behavior.handoff.value"]}
              onChange={(v) => edit((d) => void (d.behavior.handoff.value = v))}
            />
          )}
        </div>
        {handoff.type !== "none" && (
          <TextField
            label="Button text (optional)"
            placeholder="Chat on WhatsApp"
            value={handoff.label}
            max={40}
            error={errors["behavior.handoff.label"]}
            onChange={(v) => edit((d) => void (d.behavior.handoff.label = v))}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Questions the bot asks visitors (name, phone…) come with leads later.
        </p>
      </Section>
    </>
  );
}
