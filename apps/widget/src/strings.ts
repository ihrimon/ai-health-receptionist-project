/**
 * Every text the visitor sees, in one place (decision B4: English only at
 * launch). A later translation only swaps this object.
 */
export const STRINGS = {
  closeChat: "Close chat",
  inputLabel: "Your message",
  inputPlaceholder: "Type a message…",
  send: "Send",
  typing: "The assistant is typing",
  ratingQuestion: "How was this conversation?",
  rateStars: (stars: number) => `Rate ${stars} star${stars > 1 ? "s" : ""}`,
  ratingSkip: "Skip for now",
  ratingThanks: "Thanks for your feedback!",
  poweredBy: "Powered by BrainStack",
  loading: "Loading…",
  unavailable: "This chat isn't available right now.",
  somethingWrong: "Sorry, something went wrong. Please try again.",
  tooFast: "You're sending messages quickly. Please wait a minute and try again.",
} as const;
