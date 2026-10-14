"use client";

import { ChipInput, TextField } from "./fields";
import type { TabProps } from "./general-tab";
import { Section } from "./section";

/**
 * Appearance tab (D-3 §3.2). Only the texts for now: colour, position and
 * launcher icon come with the widget (M4), where a preview shows them.
 */
export function AppearanceTab({ draft, edit, errors }: TabProps) {
  const { widget } = draft;
  return (
    <>
      <Section title="Chat window">
        <TextField
          label="Header title"
          hint="Shown at the top of the chat window."
          value={widget.headerTitle}
          max={40}
          error={errors["widget.headerTitle"]}
          onChange={(v) => edit((d) => void (d.widget.headerTitle = v))}
        />
        <ChipInput
          label="Quick replies"
          hint="Buttons visitors can tap instead of typing, shown when the chat opens."
          placeholder="e.g. Delivery options"
          values={widget.quickReplies}
          max={4}
          maxLength={60}
          error={errors["widget.quickReplies"]}
          onChange={(v) => edit((d) => void (d.widget.quickReplies = v))}
        />
      </Section>
      <p className="px-1 text-xs text-muted-foreground">
        Colour, position and launcher icon come with the website widget, along
        with a live preview.
      </p>
    </>
  );
}
