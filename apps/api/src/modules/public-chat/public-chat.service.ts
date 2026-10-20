import {
  type ChatbotConfig,
  chatbotConfigSchema,
  PUBLIC_CHAT_SIZES,
  type PublicChatConfig,
  type PublicConversation,
  LEAD_REQUEST_ANSWER_ID,
  type PublicConversationRequest,
  type PublicLeadRequest,
  type PublicMessageRequest,
  type PublicMessageView,
  type PublicRatingRequest,
} from '@brainstack/shared';
import {
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoadTestConfig } from '../../config/load-test';
import type { EmitChatEvent } from '../../common/sse';
import { PrismaService } from '../../database/prisma.service';
import {
  ChatbotStatus,
  WorkspaceRole,
  WorkspaceStatus,
} from '../../generated/prisma/client';
import {
  RateLimitedException,
  RateLimitService,
} from '../../rate-limit/rate-limit.service';
import { runAsSystem, runWithTenant } from '../../tenancy/tenant-context';
import { ConversationsService } from '../conversations/conversations.service';
import { LeadsService } from '../leads/leads.service';
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
  /**
   * M7-22: a cap on what one chatbot can cost per UTC day, so a script
   * spread over many IPs can't run up the company's bill. Lead's call
   * (2026-10-18): 200 messages.
   */
  perBotDay: { limit: 200, windowSeconds: 86400 },
  /** Changing the stars a few times is fine; more is a script. */
  ratingPerConversationMinute: { limit: 10, windowSeconds: 60 },
  /** A visitor fills the contact form once, maybe twice; more is a script (M7-41). */
  leadPerConversationHour: { limit: 5, windowSeconds: 3600 },
  leadPerIpHour: { limit: 20, windowSeconds: 3600 },
};

// Visitors don't manage keys: the dashboard wording would confuse them.
export const VISITOR_UNAVAILABLE_REPLY =
  "Sorry, this chat isn't available right now. Please try again later.";
export const VISITOR_BUSY_REPLY =
  "Sorry, I'm a bit busy right now. Please try again in a minute.";
export const VISITOR_DAILY_LIMIT_REPLY =
  "We've received a lot of messages today and can't answer more right now. Please contact us directly or try again tomorrow.";
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
    private readonly leads: LeadsService,
    @Optional() config?: ConfigService,
  ) {
    // Load-test mode only (M7-5; the config refuses it in production): a
    // local run from one IP would otherwise stop at the per-IP limits.
    const loadTest = config?.get<LoadTestConfig>('loadTest');
    this.limitFactor = loadTest?.enabled ? loadTest.rateLimitFactor : 1;
    const dashboardUrl = config?.get<string>('dashboardUrl');
    this.privacyUrl =
      typeof dashboardUrl === 'string' && dashboardUrl
        ? `${dashboardUrl.replace(/\/+$/, '')}/privacy`
        : undefined;
  }

  private readonly privacyUrl: string | undefined;

  private readonly limitFactor: number;

  private scaled(rule: { limit: number; windowSeconds: number }) {
    return { ...rule, limit: Math.ceil(rule.limit * this.limitFactor) };
  }

  async config(publicId: string): Promise<PublicChatConfig> {
    const { config } = await this.liveBot({ publicId });
    return {
      botName: config.identity.botName,
      avatarUrl: config.identity.avatarUrl,
      welcomeMessage: config.identity.welcomeMessage,
      headerTitle: config.widget.headerTitle,
      primaryColor: config.widget.primaryColor,
      position: config.widget.position,
      // No icon uploads yet (D-4), so a custom icon falls back to the default.
      launcherIcon:
        config.widget.launcherIcon === 'custom'
          ? 'chat'
          : config.widget.launcherIcon,
      quickReplies: config.widget.quickReplies,
      showBranding: config.widget.showBranding,
      ...(this.privacyUrl && { privacyUrl: this.privacyUrl }),
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
      ...this.scaled(PUBLIC_CHAT_LIMITS.newConversationHour),
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
        ...this.scaled(PUBLIC_CHAT_LIMITS.perConversationMinute),
      },
      {
        key: `public:ip:${ip}`,
        ...this.scaled(PUBLIC_CHAT_LIMITS.perIpMinute),
      },
      {
        key: `public:ip-hour:${ip}`,
        ...this.scaled(PUBLIC_CHAT_LIMITS.perIpHour),
      },
      {
        key: `public:bot:${bot.id}`,
        ...this.scaled(PUBLIC_CHAT_LIMITS.perBotMinute),
      },
    );

    // Counted apart from the rules above, so a visitor already turned away
    // by those doesn't use up the chatbot's day. Over the cap the visitor
    // gets a friendly answer pointing to the company, not an error.
    try {
      await this.rateLimit.consume({
        key: `public:bot-day:${bot.id}`,
        ...this.scaled(PUBLIC_CHAT_LIMITS.perBotDay),
      });
    } catch (err) {
      if (!(err instanceof RateLimitedException)) throw err;
      this.emitPointToCompany(
        bot,
        conversationId,
        emit,
        VISITOR_DAILY_LIMIT_REPLY,
      );
      return;
    }

    await this.inBotWorkspace(bot, async () => {
      const conversation = await this.conversations.find(
        conversationId,
        bot.id,
      );
      if (!conversation) throw new NotFoundException('Conversation not found');

      // A long chat stops here; the visitor is pointed to the company.
      if (conversation.messageCount >= PUBLIC_CHAT_SIZES.conversationMessages) {
        this.emitPointToCompany(bot, conversationId, emit, VISITOR_LIMIT_REPLY);
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

  /** A fixed reply plus the company's handoff, with no model call. */
  private emitPointToCompany(
    bot: LiveBot,
    conversationId: string,
    emit: EmitChatEvent,
    text: string,
  ): void {
    emit({ type: 'delta', text });
    const { type, value, label } = bot.config.behavior.handoff;
    if (type !== 'none' && value) {
      emit({ type: 'handoff', kind: type, value, label });
    }
    emit({ type: 'done', conversationId, answeredBy: 'fallback' });
  }

  /** The visitor's 1–5 stars for their own conversation (FR-4.6, M5-7). */
  async rate(
    conversationId: string,
    token: string | null,
    request: PublicRatingRequest,
  ): Promise<void> {
    const claims = this.authorize(conversationId, token);
    const bot = await this.liveBot({ id: claims.chatbotId });
    await this.rateLimit.consume({
      key: `public:rating:${conversationId}`,
      ...this.scaled(PUBLIC_CHAT_LIMITS.ratingPerConversationMinute),
    });
    const rated = await this.inBotWorkspace(bot, () =>
      this.conversations.rate(conversationId, bot.id, request.rating),
    );
    if (!rated) throw new NotFoundException('Conversation not found');
  }

  /**
   * The contact form of the widget (M7-41): saves a lead in this very
   * conversation, in the chatbot's own workspace. The chatbot and
   * conversation come from the signed token, never from the request, so a
   * visitor can only add a lead to their own chat.
   */
  async submitLead(
    conversationId: string,
    token: string | null,
    ip: string,
    request: PublicLeadRequest,
  ): Promise<void> {
    const claims = this.authorize(conversationId, token);
    const bot = await this.liveBot({ id: claims.chatbotId });
    await this.rateLimit.consume(
      {
        key: `public:lead:${conversationId}`,
        ...this.scaled(PUBLIC_CHAT_LIMITS.leadPerConversationHour),
      },
      {
        key: `public:lead-ip:${ip}`,
        ...this.scaled(PUBLIC_CHAT_LIMITS.leadPerIpHour),
      },
    );
    await this.inBotWorkspace(bot, async () => {
      const conversation = await this.conversations.find(
        conversationId,
        bot.id,
      );
      if (!conversation) throw new NotFoundException('Conversation not found');
      await this.leads.create({
        chatbotId: bot.id,
        conversationId,
        name: request.name,
        email: request.email,
        phone: request.phone,
        answers: request.message
          ? { [LEAD_REQUEST_ANSWER_ID]: request.message }
          : undefined,
      });
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
    // A visitor has no session; the publicId is what finds the workspace
    // (M7-1: the only lookup of this chat flow outside its workspace).
    // One transaction for the chatbot and its two relations, not three (M7-32).
    const bot = await runAsSystem('find chatbot by public id', () =>
      this.prisma.$transaction((tx) =>
        tx.chatbot.findUnique({
          where,
          select: {
            id: true,
            workspaceId: true,
            status: true,
            workspace: { select: { status: true } },
            publishedVersion: { select: { id: true, config: true } },
          },
        }),
      ),
    );
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
