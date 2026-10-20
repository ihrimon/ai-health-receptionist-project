import { z } from 'zod';
import { LEAD_LIMITS } from './leads';
import { text } from './text';

/**
 * The embeddable widget's public API (D-2 §3): no login. A visitor starts a
 * conversation and gets a signed `conversationToken`; that token (sent as
 * `Authorization: Bearer`) is what lets them send messages to, and read
 * back, that one conversation. The answer streams back as
 * `ChatStreamEvent`s (without `sources`, which are for the dashboard) and
 * the server keeps the history.
 */

export const PUBLIC_CHAT_SIZES = {
  messageChars: 1000,
  /** Messages (both sides) one conversation may hold. */
  conversationMessages: 50,
} as const;

/** The random ID the widget makes for a visitor; no personal data. */
export const visitorIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** POST /v1/public/chatbots/:publicId/conversations */
export const publicConversationRequestSchema = z.strictObject({
  visitorId: visitorIdSchema,
  /** The page the chat starts on. */
  originUrl: z.url().max(500).optional(),
});
export type PublicConversationRequest = z.output<
  typeof publicConversationRequestSchema
>;

export interface PublicConversation {
  conversationId: string;
  conversationToken: string;
}

/** POST /v1/public/conversations/:id/messages */
export const publicMessageRequestSchema = z.strictObject({
  message: text(1, PUBLIC_CHAT_SIZES.messageChars, true),
});
export type PublicMessageRequest = z.output<typeof publicMessageRequestSchema>;

/** POST /v1/public/conversations/:id/rating: the visitor's 1–5 stars (FR-4.6, M5-7). */
export const publicRatingRequestSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
});
export type PublicRatingRequest = z.output<typeof publicRatingRequestSchema>;

/** Longest "what do you need" text of the contact form. */
export const PUBLIC_LEAD_MESSAGE_CHARS = 500;

/**
 * POST /v1/public/conversations/:id/lead: the widget's contact form (M7-41).
 * A name, and an email or a phone number so the business can answer; what
 * they need is optional. Saves a lead in this conversation (a second
 * submit fills in the same lead).
 */
export const publicLeadRequestSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'Please enter your name')
      .max(LEAD_LIMITS.name),
    email: z
      .string()
      .trim()
      .max(LEAD_LIMITS.email)
      .transform((v) => v.toLowerCase() || undefined)
      .pipe(z.email('Please enter a valid email address').optional())
      .optional(),
    phone: z
      .string()
      .trim()
      .max(LEAD_LIMITS.phone)
      .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - . only')
      .transform((v) => v || undefined)
      .optional(),
    message: z
      .string()
      .trim()
      .max(PUBLIC_LEAD_MESSAGE_CHARS)
      .transform((v) => v || undefined)
      .optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Please give an email address or a phone number',
    path: ['email'],
  });
export type PublicLeadRequest = z.output<typeof publicLeadRequestSchema>;

/** GET /v1/public/conversations/:id/messages: what a reload shows again. */
export interface PublicMessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

/** The built-in launcher icons the loader can draw (FR-3.6). */
export const LAUNCHER_ICONS = ['chat', 'sparkle', 'help'] as const;
export type LauncherIcon = (typeof LAUNCHER_ICONS)[number];

/** GET /v1/public/chatbots/:publicId/config: what the widget shows. */
export interface PublicChatConfig {
  botName: string;
  avatarUrl: string | null;
  welcomeMessage: string;
  headerTitle: string;
  primaryColor: string;
  position: 'right' | 'left';
  /** The launcher button's icon; a 'custom' one shows 'chat' until icon uploads exist. */
  launcherIcon: LauncherIcon;
  quickReplies: string[];
  showBranding: boolean;
  /** The Privacy Policy the widget's notice links to (M7-14); absent if the API doesn't know the dashboard's address. */
  privacyUrl?: string;
}
