import { z } from 'zod';
import { text } from './text';

/**
 * Request bodies for the knowledge base API (D-2 §2.3): FAQs, custom
 * answers and policy/text pages. The dashboard can reuse them for its forms.
 */

/**
 * Items allowed per chatbot in the MVP (lead's call, 2026-10-13). Plan-based
 * limits replace these with billing (milestone 6).
 */
export const KNOWLEDGE_LIMITS = {
  faqs: 25,
  customAnswers: 50,
  /** POLICY and TEXT pages together. */
  textSources: 50,
} as const;

/** At least one field: an empty PATCH is a mistake, not a no-op. */
function hasAnyField(value: object): boolean {
  return Object.keys(value).length > 0;
}
const NOTHING_TO_UPDATE = { message: 'Nothing to update' };

const faqFields = {
  question: text(1, 500),
  answer: text(1, 4000, true),
};

export const createFaqSchema = z.strictObject(faqFields);
export const updateFaqSchema = z
  .strictObject(faqFields)
  .partial()
  .refine(hasAnyField, NOTHING_TO_UPDATE);

/** Every FAQ of the chatbot, in the new display order. */
export const faqOrderSchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .max(KNOWLEDGE_LIMITS.faqs)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'IDs must be unique',
    }),
});

const customAnswerFields = {
  triggerQuestion: text(1, 500),
  answer: text(1, 4000, true),
  isActive: z.boolean(),
};

export const createCustomAnswerSchema = z.strictObject({
  ...customAnswerFields,
  isActive: customAnswerFields.isActive.default(true),
});
export const updateCustomAnswerSchema = z
  .strictObject(customAnswerFields)
  .partial()
  .refine(hasAnyField, NOTHING_TO_UPDATE);

/** Source types written in the dashboard; documents are uploaded (M2-10). */
export const TEXT_SOURCE_TYPES = ['POLICY', 'TEXT'] as const;

const textSourceFields = {
  title: text(1, 200),
  /** Markdown. */
  content: text(1, 50_000, true),
};

export const createTextSourceSchema = z.strictObject({
  type: z.enum(TEXT_SOURCE_TYPES),
  ...textSourceFields,
});
/** The type can't change; delete and re-create instead. */
export const updateTextSourceSchema = z
  .strictObject(textSourceFields)
  .partial()
  .refine(hasAnyField, NOTHING_TO_UPDATE);

export type CreateFaq = z.output<typeof createFaqSchema>;
export type UpdateFaq = z.output<typeof updateFaqSchema>;
export type FaqOrder = z.output<typeof faqOrderSchema>;
export type CreateCustomAnswer = z.output<typeof createCustomAnswerSchema>;
export type UpdateCustomAnswer = z.output<typeof updateCustomAnswerSchema>;
export type CreateTextSource = z.output<typeof createTextSourceSchema>;
export type UpdateTextSource = z.output<typeof updateTextSourceSchema>;
