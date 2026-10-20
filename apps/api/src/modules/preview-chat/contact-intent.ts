/**
 * Words that say the visitor wants to buy, book or be contacted (M7-41).
 * It only decides that a message is worth sending to the model when no
 * knowledge matched (the contact form is offered then); the model decides
 * whether to show the form. Broad on purpose: a wrong guess costs one model
 * call, a miss would send a ready customer to the generic fallback.
 */
const INTENT =
  /\b(book(ing|ed)?|appointments?|schedule|quotes?|quotations?|estimates?|hire|sign ?up|get started|buy|purchase|orders?|call me|call back|callback|contact me|reach me|reach out|get in touch|talk to|speak (to|with)|consultations?|demos?|interested|sales)\b/i;

export function wantsToBeContacted(message: string): boolean {
  return INTENT.test(message);
}
