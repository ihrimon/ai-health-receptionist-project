/**
 * The embeddable widget's public API (early MVP, M4): no login, runs the
 * published config on the company's own knowledge and API key. Like the
 * preview, the browser keeps the history and each message carries it, so
 * the request body is the preview's (previewChatRequestSchema).
 */

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

/** Visitors get the answer only; sources are for the dashboard. */
export interface PublicChatReply {
  reply: string;
}
