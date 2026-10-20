/**
 * Every text the visitor sees, in one place (decision B4: English only at
 * launch). A later translation only swaps this object.
 */
export const STRINGS = {
  minimizeChat: "Minimize chat",
  /** The scrollable list of messages, for screen readers. */
  conversation: "Conversation",
  inputLabel: "Your message",
  inputPlaceholder: "Type a message…",
  send: "Send",
  typing: "The assistant is typing",
  ratingQuestion: "How was this conversation?",
  rateStars: (stars: number) => `Rate ${stars} star${stars > 1 ? "s" : ""}`,
  ratingSkip: "Skip for now",
  ratingThanks: "Thanks for your feedback!",
  poweredBy: "Powered by BrainStack",
  /** Shown under the messages (M7-14): who answers and what is kept. */
  privacyNotice: "An AI assistant answers here, and this chat is saved so the business can follow up. Please don't share passwords or card numbers.",
  privacyLink: "Privacy Policy",
  loading: "Loading…",
  unavailable: "This chat isn't available right now.",
  somethingWrong: "Sorry, something went wrong. Please try again.",
  tooFast: "You're sending messages quickly. Please wait a minute and try again.",
  quickReplies: "Suggested questions",
  /** The contact form the bot shows when a visitor wants to buy or book (M7-41). */
  leadForm: {
    label: "Contact details",
    intro: "Leave your details and we'll get back to you.",
    name: "Your name",
    email: "Email",
    phone: "Phone",
    message: "What do you need? (optional)",
    submit: "Send my details",
    sending: "Sending…",
    nameRequired: "Please enter your name.",
    contactRequired: "Please give an email address or a phone number.",
    emailInvalid: "That email address doesn't look right.",
    failed: "Sorry, we couldn't send that. Please try again.",
    thanks: "Thanks! We've got your details and will get back to you soon.",
  },
  /** The handoff button's text when the company gave none. */
  handoff: {
    email: "Email us",
    phone: "Call us",
    whatsapp: "Chat on WhatsApp",
    url: "Contact us",
  },
} as const;

/** The loader's texts on the company's page (`chatbot.js`, M4-9); a separate object so its bundle takes only these. */
export const LOADER_STRINGS = {
  openChat: "Open chat",
  closeChat: "Close chat",
  /** Added to the launcher's label while answers wait unread. */
  unread: (count: number) => `${count} new message${count > 1 ? "s" : ""}`,
  frameTitle: "Chat",
} as const;
