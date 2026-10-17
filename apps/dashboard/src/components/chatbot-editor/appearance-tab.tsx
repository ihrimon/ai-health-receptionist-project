"use client";

import { cn } from "cn";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  COLOR_PRESETS,
  LAUNCHER_ICON_OPTIONS,
  normalizeHex,
  POSITION_OPTIONS,
  previewBrand,
  previewIcon,
} from "@/lib/appearance";
import { ChipInput, Field, TextField } from "./fields";
import type { TabProps } from "./general-tab";
import { Section } from "./section";
import { LAUNCHER_ICON_COMPONENTS, WidgetPreview } from "./widget-preview";

const optionClass = (selected: boolean) =>
  cn(
    "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-60",
    selected && "border-primary ring-1 ring-primary",
  );

/**
 * Appearance tab (D-3 §3.2, M4-12, FR-3.6): the widget's brand color,
 * corner, launcher icon, header title and quick replies, with a live
 * preview of the draft next to them. The website widget and its launcher
 * use these after publishing.
 */
export function AppearanceTab({ draft, edit, errors }: TabProps) {
  const { widget } = draft;
  const colorId = useId();
  const colorError = errors["widget.primaryColor"];
  // The native picker needs a valid color even while the text is mid-typing.
  const pickerValue = previewBrand(widget.primaryColor).background;
  const setColor = (value: string) =>
    edit((d) => void (d.widget.primaryColor = value));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-4">
        <Section title="Brand" description="How the chat looks on your website.">
          <Field
            label="Primary color"
            htmlFor={colorId}
            hint="Used for the button, the chat header and visitor messages. Text on it turns black or white to stay readable."
            error={colorError}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a color"
                value={pickerValue.toLowerCase()}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed"
              />
              <Input
                id={colorId}
                value={widget.primaryColor}
                maxLength={7}
                placeholder="#0F766E"
                aria-invalid={colorError ? true : undefined}
                className="w-28 font-mono uppercase"
                onChange={(e) => setColor(e.target.value)}
                onBlur={(e) => setColor(normalizeHex(e.target.value))}
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested colors">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  aria-pressed={widget.primaryColor.toUpperCase() === color}
                  onClick={() => setColor(color)}
                  className={cn(
                    "size-6 rounded-full border border-black/10 disabled:pointer-events-none disabled:opacity-60",
                    widget.primaryColor.toUpperCase() === color &&
                      "ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Field>

          <Field label="Position" hint="The corner of the page where the chat button sits.">
            <div role="radiogroup" aria-label="Position" className="grid gap-2 sm:grid-cols-2">
              {POSITION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={widget.position === option.value}
                  onClick={() => edit((d) => void (d.widget.position = option.value))}
                  className={optionClass(widget.position === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Launcher icon" hint="The icon on the round chat button.">
            <div role="radiogroup" aria-label="Launcher icon" className="grid grid-cols-3 gap-2">
              {LAUNCHER_ICON_OPTIONS.map((option) => {
                const Icon = LAUNCHER_ICON_COMPONENTS[option.value];
                const selected = previewIcon(widget.launcherIcon) === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() =>
                      edit((d) => {
                        d.widget.launcherIcon = option.value;
                        d.widget.launcherIconUrl = null;
                      })
                    }
                    className={cn(optionClass(selected), "justify-center")}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </Section>

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
      </div>

      <div className="min-w-0 lg:sticky lg:top-4">
        <WidgetPreview draft={draft} />
      </div>
    </div>
  );
}
