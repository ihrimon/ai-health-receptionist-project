import { z } from 'zod';

/** Field helpers shared by the schemas in this package. */

// Line breaks are fine in long text (instructions, descriptions), never in
// one-line fields like names and labels. Other control characters never.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINE_BREAKS = /[\n\r\t]/;

function hasControlChars(value: string, multiline: boolean): boolean {
  return (
    CONTROL_CHARS.test(value) || (!multiline && LINE_BREAKS.test(value))
  );
}

/** Required text, trimmed, `min`–`max` characters. */
export function text(min: number, max: number, multiline = false) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !hasControlChars(v, multiline), {
      message: 'Must not contain control characters',
    });
}

/**
 * Nullable field: trimmed, and blank becomes null, so an emptied form
 * input is stored as "not set" instead of "".
 */
export function optional<T extends z.ZodType>(inner: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }, inner.nullable());
}
