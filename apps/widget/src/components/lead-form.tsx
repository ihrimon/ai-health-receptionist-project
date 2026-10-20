import { useState } from "preact/hooks";
import { ApiError } from "../api";
import { STRINGS } from "../strings";
import type { Brand } from "../theme";
import type { LeadFormFields } from "../types";

const FIELD =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base focus:border-zinc-500 sm:text-sm";

/** Same shape the API accepts: something@something.tld, nothing fancier. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with the fields, in the visitor's words; null when they are fine. */
export function leadFormProblem(fields: LeadFormFields): string | null {
  if (!fields.name.trim()) return STRINGS.leadForm.nameRequired;
  const email = fields.email?.trim() ?? "";
  const phone = fields.phone?.trim() ?? "";
  if (!email && !phone) return STRINGS.leadForm.contactRequired;
  if (email && !EMAIL.test(email)) return STRINGS.leadForm.emailInvalid;
  return null;
}

/**
 * The short contact form the bot shows when a visitor wants to buy or book
 * (M7-41). What is typed goes straight to the API, never through the model.
 * `onSubmit` throws when the API refuses; the form then says so and stays.
 */
export function LeadForm({
  brand,
  onSubmit,
}: {
  brand: Brand;
  onSubmit: (fields: LeadFormFields) => Promise<void>;
}) {
  const [fields, setFields] = useState({ name: "", email: "", phone: "", message: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const set = (key: keyof typeof fields) => (e: Event) =>
    setFields((f) => ({ ...f, [key]: (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value }));

  async function submit(e: Event) {
    e.preventDefault();
    if (sending) return;
    const found = leadFormProblem(fields);
    setProblem(found);
    if (found) return;
    setSending(true);
    try {
      await onSubmit({
        name: fields.name.trim(),
        ...(fields.email.trim() && { email: fields.email.trim() }),
        ...(fields.phone.trim() && { phone: fields.phone.trim() }),
        ...(fields.message.trim() && { message: fields.message.trim() }),
      });
    } catch (err) {
      setProblem(err instanceof ApiError && err.status === 429 ? STRINGS.tooFast : STRINGS.leadForm.failed);
      setSending(false);
    }
  }

  return (
    <form
      aria-label={STRINGS.leadForm.label}
      noValidate
      class="grid w-full max-w-[90%] gap-2 rounded-2xl border border-zinc-200 p-3"
      onSubmit={submit}
    >
      <p class="text-xs text-zinc-600">{STRINGS.leadForm.intro}</p>
      <input
        class={FIELD}
        aria-label={STRINGS.leadForm.name}
        placeholder={STRINGS.leadForm.name}
        autoComplete="name"
        maxLength={100}
        value={fields.name}
        onInput={set("name")}
      />
      <input
        class={FIELD}
        type="email"
        aria-label={STRINGS.leadForm.email}
        placeholder={STRINGS.leadForm.email}
        autoComplete="email"
        maxLength={255}
        value={fields.email}
        onInput={set("email")}
      />
      <input
        class={FIELD}
        type="tel"
        aria-label={STRINGS.leadForm.phone}
        placeholder={STRINGS.leadForm.phone}
        autoComplete="tel"
        maxLength={30}
        value={fields.phone}
        onInput={set("phone")}
      />
      <textarea
        class={`${FIELD} min-h-16 resize-none`}
        aria-label={STRINGS.leadForm.message}
        placeholder={STRINGS.leadForm.message}
        maxLength={500}
        rows={2}
        value={fields.message}
        onInput={set("message")}
      />
      {problem && (
        <p role="alert" class="text-xs text-red-600">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={sending}
        class="rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
        style={{ ...brand }}
      >
        {sending ? STRINGS.leadForm.sending : STRINGS.leadForm.submit}
      </button>
    </form>
  );
}
