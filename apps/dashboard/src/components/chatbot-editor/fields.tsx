"use client";

import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addChip } from "@/lib/config-form";

/** A labelled control with an optional hint, counter and error. */
export function Field({
  label,
  hint,
  error,
  count,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** [used, max] characters, shown next to the label. */
  count?: [number, number];
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {count && (
          <span
            className={
              count[0] > count[1]
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {count[0]} / {count[1]}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

interface TextProps {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  /** Shows a counter; the schema enforces the limit. */
  max?: number;
  type?: "text" | "email" | "url" | "tel";
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  max,
  type = "text",
}: TextProps) {
  const id = useId();
  const text = value ?? "";
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={id}
      count={max ? [text.length, max] : undefined}
    >
      <Input
        id={id}
        type={type}
        value={text}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  max,
  rows = 3,
}: Omit<TextProps, "type"> & { rows?: number }) {
  const id = useId();
  const text = value ?? "";
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={id}
      count={max ? [text.length, max] : undefined}
    >
      <Textarea
        id={id}
        rows={rows}
        value={text}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * A list of short texts (topics, quick replies): type and press Enter to
 * add, click × to remove.
 */
export function ChipInput({
  label,
  hint,
  values,
  onChange,
  max,
  maxLength,
  placeholder,
  error,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  maxLength: number;
  placeholder?: string;
  error?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string>();

  function add() {
    const result = addChip(values, text, max, maxLength);
    setInputError(result.error);
    if (!result.error) {
      onChange(result.list);
      setText("");
    }
  }

  return (
    <Field
      label={label}
      hint={hint}
      error={inputError ?? error}
      htmlFor={id}
      count={[values.length, max]}
    >
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className="flex items-center gap-1 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 text-sm"
            >
              {value}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setInputError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
    </Field>
  );
}
