import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

// Only for development and tests; production must set its own secret.
const DEV_SECRET = 'brainstack-dev-only-conversation-token-secret';
/** A visitor's token lasts a day; the widget starts a new conversation after that. */
export const CONVERSATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export interface ConversationClaims {
  conversationId: string;
  chatbotId: string;
}

/**
 * The conversation token (D-2 §4): signed by us, tied to one conversation
 * and one chatbot, so a visitor can only continue their own chat. Stored
 * form: `<base64url JSON>.<base64url HMAC-SHA256>`. It proves the caller
 * started that conversation; it is not a login.
 */
@Injectable()
export class ConversationTokenService {
  private readonly logger = new Logger(ConversationTokenService.name);
  private readonly secret: string | null;
  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(config: ConfigService) {
    let secret = config.get<string>('security.conversationTokenSecret') ?? '';
    if (!secret && config.get<string>('nodeEnv') !== 'production') {
      this.logger.warn(
        'CONVERSATION_TOKEN_SECRET is not set; using the development secret.',
      );
      secret = DEV_SECRET;
    }
    this.secret = secret || null;
  }

  sign(claims: ConversationClaims): string {
    const payload = Buffer.from(
      JSON.stringify({
        c: claims.conversationId,
        b: claims.chatbotId,
        e: Math.floor(this.now() / 1000) + CONVERSATION_TOKEN_TTL_SECONDS,
      }),
    ).toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }

  /** The claims of a genuine, unexpired token; null for anything else. */
  verify(token: string): ConversationClaims | null {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;

    const expected = Buffer.from(this.signature(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    try {
      const data = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { c?: unknown; b?: unknown; e?: unknown };
      if (
        typeof data.c !== 'string' ||
        typeof data.b !== 'string' ||
        typeof data.e !== 'number' ||
        data.e * 1000 < this.now()
      ) {
        return null;
      }
      return { conversationId: data.c, chatbotId: data.b };
    } catch {
      return null;
    }
  }

  private signature(payload: string): string {
    if (!this.secret) {
      throw new ServiceUnavailableException(
        'Chat is not set up on this server (CONVERSATION_TOKEN_SECRET).',
      );
    }
    return createHmac('sha256', this.secret)
      .update(payload)
      .digest('base64url');
  }
}
