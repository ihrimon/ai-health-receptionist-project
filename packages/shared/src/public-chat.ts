import { z } from 'zod';
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

/** GET /v1/public/conversations/:id/messages: what a reload shows again. */
export interface PublicMessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

/** GET /v1/public/chatbots/:publicId/config: what the widget shows. */
export interface PublicChatConfig {
  botName: string;
  avatarUrl: string | null;
  welcomeMessage: string;
  headerTitle: string;
  primaryColor: string;
  position: 'right' | 'left';
  quickReplies: string[];
  showBranding: boolean;
}
