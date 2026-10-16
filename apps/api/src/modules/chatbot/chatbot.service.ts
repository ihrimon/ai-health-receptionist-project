import {
  type ChatbotConfig,
  checkAllowedDomains,
  chatbotConfigSchema,
  configPublishProblems,
  type PublishProblem,
} from '@brainstack/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotStatus, Prisma } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { sameJson } from './same-json';

const WITH_PUBLISHED = {
  include: {
    publishedVersion: {
      select: { version: true, publishedAt: true, config: true },
    },
  },
} as const;

type ChatbotRow = Prisma.ChatbotGetPayload<typeof WITH_PUBLISHED>;

/** GET /v1/chatbot (D-2 §2.2). `installVerifiedAt` arrives with M4-14. */
export interface ChatbotView {
  id: string;
  publicId: string;
  status: ChatbotStatus;
  draftConfig: unknown;
  publishedVersion: { version: number; publishedAt: Date } | null;
  /** Also true before the first publish: nothing is live yet. */
  hasUnpublishedChanges: boolean;
  /** Why publishing would fail right now; empty when it's allowed. */
  publishProblems: PublishProblem[];
  allowedDomains: string[];
  embedSnippet: string;
}

function badRequest(message: string, details: unknown[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'VALIDATION_FAILED',
    message,
    details,
  });
}

/**
 * The workspace's one chatbot (M0 decision B2), so no method takes an ID:
 * the tenant client limits every query to the current workspace, and
 * `findFirst` finds that workspace's bot.
 */
@Injectable()
export class ChatbotService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly config: ConfigService,
  ) {}

  async get(): Promise<ChatbotView> {
    return this.view(await this.load());
  }

  /**
   * The current workspace's chatbot ID, for modules that store data per
   * chatbot (knowledge). Always found through the tenant client, so a row
   * never points at another workspace's chatbot.
   */
  async currentId(): Promise<string> {
    const bot = await this.db.chatbot.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!bot) throw new NotFoundException('Chatbot not found');
    return bot.id;
  }

  /** The chatbot's ID and draft config, for the dashboard preview (M3-13). */
  async draft(): Promise<{ id: string; config: ChatbotConfig }> {
    const bot = await this.db.chatbot.findFirst({
      select: { id: true, draftConfig: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!bot) throw new NotFoundException('Chatbot not found');
    return { id: bot.id, config: chatbotConfigSchema.parse(bot.draftConfig) };
  }

  /**
   * The currency new products get when none is given: the draft config's
   * business.currency, or USD (the D-4 default) if the draft is unreadable.
   */
  async defaultCurrency(): Promise<string> {
    const bot = await this.db.chatbot.findFirst({
      select: { draftConfig: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!bot) throw new NotFoundException('Chatbot not found');
    const draft = chatbotConfigSchema.safeParse(bot.draftConfig);
    return draft.success ? draft.data.business.currency : 'USD';
  }

  /** Saves the draft. The live config only changes on publish (FR-6.5). */
  async saveDraft(draft: ChatbotConfig): Promise<ChatbotView> {
    // Images must come from our upload API (D-4 §3), which needs file
    // storage (M2-9). Until then, no image URL is accepted.
    const images = [
      ['identity.avatarUrl', draft.identity.avatarUrl],
      ['widget.launcherIconUrl', draft.widget.launcherIconUrl],
    ].filter(([, url]) => url !== null);
    if (images.length) {
      throw badRequest(
        'Image uploads are not available yet',
        images.map(([path]) => ({
          path,
          message: 'Image uploads are not available yet',
        })),
      );
    }

    const bot = await this.load();
    const saved = await this.db.chatbot.update({
      where: { id: bot.id },
      data: { draftConfig: draft },
      ...WITH_PUBLISHED,
    });
    return this.view(saved);
  }

  /**
   * Copies the draft into a new, immutable ChatbotVersion and makes it the
   * live one (D-1 decision 5). Publishing an unchanged draft is a no-op, so
   * a double click doesn't create an empty version.
   */
  async publish(publishedById: string): Promise<ChatbotView> {
    const bot = await this.load();
    const problems = await this.publishProblems(bot);
    if (problems.length) {
      throw badRequest(problems.map((p) => p.message).join(' '), problems);
    }
    if (!this.hasUnpublishedChanges(bot)) return this.view(bot);

    const draft = chatbotConfigSchema.parse(bot.draftConfig);
    try {
      const published = await this.db.$transaction(async (tx) => {
        const latest = await tx.chatbotVersion.aggregate({
          where: { chatbotId: bot.id },
          _max: { version: true },
        });
        const version = await tx.chatbotVersion.create({
          data: {
            workspaceId: requireTenant().workspaceId,
            chatbotId: bot.id,
            version: (latest._max.version ?? 0) + 1,
            config: draft,
            publishedById,
          },
        });
        return tx.chatbot.update({
          where: { id: bot.id },
          data: { publishedVersionId: version.id },
          ...WITH_PUBLISHED,
        });
      });
      return this.view(published);
    } catch (err) {
      // Two publishes raced for the same version number.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Another publish just happened; reload');
      }
      throw err;
    }
  }

  /** Resets the draft to the live config (D-2 §2.2). */
  async discardDraft(): Promise<ChatbotView> {
    const bot = await this.load();
    if (!bot.publishedVersion) {
      throw new ConflictException('Nothing has been published yet');
    }
    const saved = await this.db.chatbot.update({
      where: { id: bot.id },
      data: {
        draftConfig: bot.publishedVersion.config as Prisma.InputJsonValue,
      },
      ...WITH_PUBLISHED,
    });
    return this.view(saved);
  }

  /** Turns the bot on or off; takes effect right away, no publish needed. */
  async setStatus(status: ChatbotStatus): Promise<ChatbotView> {
    const bot = await this.load();
    const saved = await this.db.chatbot.update({
      where: { id: bot.id },
      data: { status },
      ...WITH_PUBLISHED,
    });
    return this.view(saved);
  }

  /** Replaces the embed allow-list; takes effect right away. */
  async setAllowedDomains(input: string[]): Promise<ChatbotView> {
    const allowLocalhost = this.config.get<string>('nodeEnv') !== 'production';
    const check = checkAllowedDomains(input, allowLocalhost);
    if (!check.ok) {
      throw badRequest(
        check.problems
          .map((p) => (p.domain ? `${p.domain}: ${p.message}` : p.message))
          .join('; '),
        check.problems,
      );
    }
    const bot = await this.load();
    const saved = await this.db.chatbot.update({
      where: { id: bot.id },
      data: { allowedDomains: check.domains },
      ...WITH_PUBLISHED,
    });
    return this.view(saved);
  }

  private async load(): Promise<ChatbotRow> {
    const bot = await this.db.chatbot.findFirst({
      ...WITH_PUBLISHED,
      orderBy: { createdAt: 'asc' },
    });
    if (!bot) throw new NotFoundException('Chatbot not found');
    return bot;
  }

  private hasUnpublishedChanges(bot: ChatbotRow): boolean {
    return (
      !bot.publishedVersion ||
      !sameJson(bot.draftConfig, bot.publishedVersion.config)
    );
  }

  private async publishProblems(bot: ChatbotRow): Promise<PublishProblem[]> {
    // Drafts are validated on save, but one saved under an older schema
    // version could still fail; it must be fixed before going live.
    const draft = chatbotConfigSchema.safeParse(bot.draftConfig);
    if (!draft.success) {
      return [
        {
          code: 'DRAFT_INVALID',
          message: 'The draft has invalid settings; save it again.',
        },
      ];
    }
    const problems = configPublishProblems(draft.data);
    if ((await this.knowledgeItemCount(bot.id)) === 0) {
      problems.push({
        code: 'KNOWLEDGE_MISSING',
        message:
          'Add at least one FAQ, policy or product so the bot has something to answer from.',
      });
    }
    return problems;
  }

  /**
   * Knowledge the bot can answer from (D-4 §4): FAQs, policy/text pages,
   * active products and ready documents. Custom answers don't count: they
   * only cover the exact questions they name.
   */
  private async knowledgeItemCount(chatbotId: string): Promise<number> {
    const [faqs, sources, products] = await Promise.all([
      this.db.faq.count({ where: { chatbotId } }),
      this.db.knowledgeSource.count({
        where: {
          chatbotId,
          OR: [{ type: { in: ['POLICY', 'TEXT'] } }, { status: 'READY' }],
        },
      }),
      this.db.product.count({ where: { chatbotId, isActive: true } }),
    ]);
    return faqs + sources + products;
  }

  private async view(bot: ChatbotRow): Promise<ChatbotView> {
    const loaderUrl = this.config.get<string>('widgetLoaderUrl');
    return {
      id: bot.id,
      publicId: bot.publicId,
      status: bot.status,
      draftConfig: bot.draftConfig,
      publishedVersion: bot.publishedVersion && {
        version: bot.publishedVersion.version,
        publishedAt: bot.publishedVersion.publishedAt,
      },
      hasUnpublishedChanges: this.hasUnpublishedChanges(bot),
      publishProblems: await this.publishProblems(bot),
      allowedDomains: bot.allowedDomains,
      embedSnippet: `<script src="${loaderUrl}" data-chatbot-id="${bot.publicId}" async></script>`,
    };
  }
}
