import {
  type ChatbotConfig,
  chatbotConfigSchema,
  PUBLIC_CHAT_SIZES,
  type PublicChatConfig,
  type PublicConversation,
  type PublicConversationRequest,
  type PublicMessageRequest,
  type PublicMessageView,
} from '@brainstack/shared';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { EmitChatEvent } from '../../common/sse';
import { PrismaService } from '../../database/prisma.service';
import {
  ChatbotStatus,
  WorkspaceRole,
  WorkspaceStatus,
} from '../../generated/prisma/client';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { runWithTenant } from '../../tenancy/tenant-context';
import { ConversationsService } from '../conversations/conversations.service';
import { PreviewChatService } from '../preview-chat/preview-chat.service';
import {
  type ConversationClaims,
  ConversationTokenService,
} from './conversation-token.service';

/**
 * D-2 §5. The endpoints are open to anyone and each message costs the
 * company money on its own key, so these stay tight.
 */
export const PUBLIC_CHAT_LIMITS = {
  newConversationHour: { limit: 10, windowSeconds: 3600 },
  perConversationMinute: { limit: 20, windowSeconds: 60 },
  perIpMinute: { limit: 60, windowSeconds: 60 },
  perIpHour: { limit: 200, windowSeconds: 3600 },
  perBotMinute: { limit: 600, windowSeconds: 60 },
};

// Visitors don't manage keys: the dashboard wording would confuse them.
export const VISITOR_UNAVAILABLE_REPLY =
  "Sorry, this chat isn't available right now. Please try again later.";
export const VISITOR_BUSY_REPLY =
  "Sorry, I'm a bit busy right now. Please try again in a minute.";
export const VISITOR_LIMIT_REPLY =
  "We've reached the length limit for this chat. Please contact us directly and we'll be glad to help.";

interface LiveBot {
  id: string;
  workspaceId: string;
  versionId: string;
  config: ChatbotConfig;
}

/**
 * The embeddable widget's backend (D-2 §3): finds the chatbot by its public
 * ID, starts conversations, and answers inside that chatbot's workspace
 * with the published config, like the dashboard preview. A visitor proves
 * a conversation is theirs with its signed token.
 */
@Injectable()
export class PublicChatService {
  constructor(
    // Platform-level lookup by public ID; tenant data is read below only
    // inside that chatbot's own workspace context.
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly preview: PreviewChatService,
    private readonly conversations: ConversationsService,
    private readonly tokens: ConversationTokenService,
  ) {}

  async config(publicId: string): Promise<PublicChatConfig> {
    const { config } = await this.liveBot({ publicId });
    return {
      botName: config.identity.botName,
      avatarUrl: config.identity.avatarUrl,
      welcomeMessage: config.identity.welcomeMessage,
      headerTitle: config.widget.headerTitle,
      primaryColor: config.widget.primaryColor,
      position: config.widget.position,
      quickReplies: config.widget.quickReplies,
      showBranding: config.widget.showBranding,
    };
  }

  /** Opens a conversation and returns the token for it. */
  async startConversation(
    publicId: string,
    ip: string,
    request: PublicConversationRequest,
  ): Promise<PublicConversation> {
    const bot = await this.liveBot({ publicId });
    await this.rateLimit.consume({
      key: `public:new:${ip}`,
      ...PUBLIC_CHAT_LIMITS.newConversationHour,
    });

    const conversationId = await this.inBotWorkspace(bot, () =>
      this.conversations.start({
        chatbotId: bot.id,
        visitorId: request.visitorId,
        originUrl: request.originUrl ?? null,
        versionId: bot.versionId,
      }),
    );
    return {
      conversationId,
      conversationToken: this.tokens.sign({
        conversationId,
        chatbotId: bot.id,
      }),
    };
  }

  /** Streams the answer to one message of a conversation. */
  async send(
    conversationId: string,
    token: string | null,
    ip: string,
    request: PublicMessageRequest,
    emit: EmitChatEvent,
  ): Promise<void> {
    const claims = this.authorize(conversationId, token);
    const bot = await this.liveBot({ id: claims.chatbotId });
    await this.rateLimit.consume(
      {
        key: `public:conv:${conversationId}`,
        ...PUBLIC_CHAT_LIMITS.perConversationMinute,
      },
      { key: `public:ip:${ip}`, ...PUBLIC_CHAT_LIMITS.perIpMinute },
      { key: `public:ip-hour:${ip}`, ...PUBLIC_CHAT_LIMITS.perIpHour },
      { key: `public:bot:${bot.id}`, ...PUBLIC_CHAT_LIMITS.perBotMinute },
    );

    await this.inBotWorkspace(bot, async () => {
      const conversation = await this.conversations.find(
        conversationId,
        bot.id,
      );
      if (!conversation) throw new NotFoundException('Conversation not found');

      // A long chat stops here; the visitor is pointed to the company.
      if (conversation.messageCount >= PUBLIC_CHAT_SIZES.conversationMessages) {
        emit({ type: 'delta', text: VISITOR_LIMIT_REPLY });
        const { type, value, label } = bot.config.behavior.handoff;
        if (type !== 'none' && value) {
          emit({ type: 'handoff', kind: type, value, label });
        }
        emit({
          type: 'done',
          conversationId,
          answeredBy: 'fallback',
        });
        return;
      }

      await this.preview.answer(
        bot.id,
        bot.config,
        { message: request.message, history: [], conversationId },
        emit,
        {
          isPreview: false,
          visitorId: conversation.visitorId,
          versionId: bot.versionId,
          includeSources: false,
          noCredentialsReply: VISITOR_UNAVAILABLE_REPLY,
          keysExhaustedReply: VISITOR_BUSY_REPLY,
        },
      );
    });
  }

  /** The conversation so far, for a reloaded page. */
  async history(
    conversationId: string,
    token: string | null,
  ): Promise<PublicMessageView[]> {
    const claims = this.authorize(conversationId, token);
    const bot = await this.liveBot({ id: claims.chatbotId });
    return this.inBotWorkspace(bot, async () => {
      const conversation = await this.conversations.find(
        conversationId,
        bot.id,
      );
      if (!conversation) throw new NotFoundException('Conversation not found');
      const messages = await this.conversations.messages(conversationId);
      return messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      }));
    });
  }

  /**
   * The token must be genuine, unexpired and issued for this very
   * conversation; anything else is a 401 that says nothing more.
   */
  private authorize(
    conversationId: string,
    token: string | null,
  ): ConversationClaims {
    const claims = token ? this.tokens.verify(token) : null;
    if (!claims || claims.conversationId !== conversationId) {
      throw new UnauthorizedException('Invalid conversation token');
    }
    return claims;
  }

  private inBotWorkspace<T>(bot: LiveBot, fn: () => Promise<T>): Promise<T> {
    return runWithTenant(
      {
        workspaceId: bot.workspaceId,
        userId: 'public-visitor',
        role: WorkspaceRole.VIEWER,
      },
      fn,
    );
  }

  /** Published, switched on, in an active workspace; anything else is a 404. */
  private async liveBot(
    where: { publicId: string } | { id: string },
  ): Promise<LiveBot> {
    const bot = await this.prisma.chatbot.findUnique({
      where,
      select: {
        id: true,
        workspaceId: true,
        status: true,
        workspace: { select: { status: true } },
        publishedVersion: { select: { id: true, config: true } },
      },
    });
    if (
      !bot ||
      bot.status !== ChatbotStatus.ENABLED ||
      bot.workspace.status !== WorkspaceStatus.ACTIVE ||
      !bot.publishedVersion
    ) {
      throw new NotFoundException('Chatbot not found');
    }
    return {
      id: bot.id,
      workspaceId: bot.workspaceId,
      versionId: bot.publishedVersion.id,
      config: chatbotConfigSchema.parse(bot.publishedVersion.config),
    };
  }
}
