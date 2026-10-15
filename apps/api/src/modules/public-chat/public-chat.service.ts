import {
  type ChatbotConfig,
  chatbotConfigSchema,
  type PreviewChatRequest,
  type PublicChatConfig,
  type PublicChatReply,
} from '@brainstack/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  ChatbotStatus,
  WorkspaceRole,
  WorkspaceStatus,
} from '../../generated/prisma/client';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { runWithTenant } from '../../tenancy/tenant-context';
import {
  KEYS_EXHAUSTED_REPLY,
  NO_CREDENTIALS_REPLY,
  PreviewChatService,
} from '../preview-chat/preview-chat.service';

/**
 * Per IP and per chatbot (D-2 §5). The endpoint is open to anyone and each
 * message costs the company money on its own key, so these stay tight.
 */
export const PUBLIC_CHAT_LIMITS = {
  perIpMinute: { limit: 20, windowSeconds: 60 },
  perIpHour: { limit: 200, windowSeconds: 3600 },
  perBotMinute: { limit: 600, windowSeconds: 60 },
};

// Visitors don't manage keys: the dashboard wording would confuse them.
export const VISITOR_UNAVAILABLE_REPLY =
  "Sorry, this chat isn't available right now. Please try again later.";
export const VISITOR_BUSY_REPLY =
  "Sorry, I'm a bit busy right now. Please try again in a minute.";

interface LiveBot {
  id: string;
  workspaceId: string;
  config: ChatbotConfig;
}

/**
 * The embeddable widget's backend (early MVP of M3-3 and M4): finds the
 * chatbot by its public ID, then answers inside its workspace with the
 * published config, exactly like the dashboard preview.
 */
@Injectable()
export class PublicChatService {
  constructor(
    // Platform-level lookup by public ID; tenant data is read below only
    // inside that chatbot's own workspace context.
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly preview: PreviewChatService,
  ) {}

  async config(publicId: string): Promise<PublicChatConfig> {
    const { config } = await this.liveBot(publicId);
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

  async send(
    publicId: string,
    ip: string,
    request: PreviewChatRequest,
  ): Promise<PublicChatReply> {
    const bot = await this.liveBot(publicId);
    await this.rateLimit.consume(
      { key: `public:ip:${ip}`, ...PUBLIC_CHAT_LIMITS.perIpMinute },
      { key: `public:ip-hour:${ip}`, ...PUBLIC_CHAT_LIMITS.perIpHour },
      { key: `public:bot:${bot.id}`, ...PUBLIC_CHAT_LIMITS.perBotMinute },
    );

    const { reply } = await runWithTenant(
      {
        workspaceId: bot.workspaceId,
        userId: 'public-visitor',
        role: WorkspaceRole.VIEWER,
      },
      () => this.preview.answer(bot.id, bot.config, request),
    );
    if (reply === NO_CREDENTIALS_REPLY) {
      return { reply: VISITOR_UNAVAILABLE_REPLY };
    }
    if (reply === KEYS_EXHAUSTED_REPLY) return { reply: VISITOR_BUSY_REPLY };
    return { reply };
  }

  /** Published, switched on, in an active workspace; anything else is a 404. */
  private async liveBot(publicId: string): Promise<LiveBot> {
    const bot = await this.prisma.chatbot.findUnique({
      where: { publicId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        workspace: { select: { status: true } },
        publishedVersion: { select: { config: true } },
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
      config: chatbotConfigSchema.parse(bot.publishedVersion.config),
    };
  }
}
