import type { ChatbotConfig } from '@brainstack/shared';

/**
 * Review item 11: after an answer that gives the visitor a way to contact
 * the business, a second message asks whether they did. It is fixed text
 * (no model call, so it is instant and can't drift), saved in the
 * conversation like any other message.
 */
export const CONTACT_FOLLOW_UP =
  "Were you able to fill in the form or reach us? If something got in the way, tell me and I'll help.";

const digits = (text: string) => text.replace(/\D/g, '');

/**
 * Whether an answer hands the visitor a way to get in touch: one of the
 * company's own contact details, or a link when the visitor asked to be
 * contacted.
 */
export function givesContactDetails(
  answer: string,
  config: ChatbotConfig,
  visitorWantsContact: boolean,
): boolean {
  const { contact } = config.business;
  const { handoff } = config.behavior;
  const lower = answer.toLowerCase();
  const answerDigits = digits(answer);
  const known = [contact.email, handoff.type === 'url' ? handoff.value : null];
  if (known.some((v) => v && lower.includes(v.toLowerCase()))) return true;
  for (const phone of [contact.phone, contact.whatsapp]) {
    // The last digits only, so "+1 (347) ..." matches "347-..." in an answer.
    const d = phone ? digits(phone).slice(-9) : '';
    if (d.length >= 6 && answerDigits.includes(d)) return true;
  }
  return visitorWantsContact && /https?:\/\//i.test(answer);
}

/** The last thing the bot said was the follow-up. */
export function lastWasFollowUp(
  history: { role: 'user' | 'assistant'; text: string }[],
): boolean {
  const last = [...history].reverse().find((t) => t.role === 'assistant');
  return last?.text === CONTACT_FOLLOW_UP;
}

/** The follow-up was already asked in this conversation. */
export function followUpAsked(
  history: { role: 'user' | 'assistant'; text: string }[],
): boolean {
  return history.some(
    (t) => t.role === 'assistant' && t.text === CONTACT_FOLLOW_UP,
  );
}
