import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ChatbotStatus, WorkspaceStatus } from '../../generated/prisma/client';
import { embeddingHost, type PageRequest } from './install-host';
import { frameAncestors } from './widget-page-headers';
import { type CachedPage, WidgetPageCache } from './widget-page.cache';

/** A chatbot's public ID ("cb_" + 16 characters); anything else is a 404 without a query. */
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Decides which sites may frame a chatbot's widget page (M4-19, D-2 §4),
 * and records the first load inside one of them ("Verify installation",
 * M4-14). A platform-level lookup by public ID, like the public chat API:
 * only the chatbot's own row is read or written, never another one's.
 */
@Injectable()
export class WidgetPageService {
  private readonly logger = new Logger(WidgetPageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: WidgetPageCache,
    private readonly config: ConfigService,
  ) {}

  private get allowLocalhost(): boolean {
    return this.config.get<string>('nodeEnv') !== 'production';
  }

  /**
   * The page info for a live chatbot (published, switched on, in an
   * active workspace), or null for anything else (a 404).
   */
  async pageFor(publicId: string): Promise<CachedPage | null> {
    if (!PUBLIC_ID.test(publicId)) return null;
    const cached = this.cache.get(publicId);
    if (cached !== null) return cached;

    const generation = this.cache.generation;
    const bot = await this.prisma.chatbot.findUnique({
      where: { publicId },
      select: {
        status: true,
        allowedDomains: true,
        publishedVersionId: true,
        installVerifiedAt: true,
        workspace: { select: { status: true } },
      },
    });
    if (
      !bot ||
      bot.status !== ChatbotStatus.ENABLED ||
      bot.workspace.status !== WorkspaceStatus.ACTIVE ||
      !bot.publishedVersionId
    ) {
      return null;
    }
    const page: CachedPage = {
      ancestors: frameAncestors(bot.allowedDomains, this.allowLocalhost),
      allowedDomains: bot.allowedDomains,
      installed: bot.installVerifiedAt !== null,
    };
    this.cache.set(publicId, page, generation);
    return page;
  }

  /**
   * Records the first page load framed by one of the chatbot's allowed
   * sites (M4-14). Only the first one counts (a later load never moves the
   * date), and a failed write never breaks the page.
   */
  async recordInstall(
    publicId: string,
    page: CachedPage,
    req: PageRequest,
  ): Promise<void> {
    if (page.installed) return;
    const host = embeddingHost(req, page.allowedDomains, this.allowLocalhost);
    if (!host) return;
    try {
      await this.prisma.chatbot.updateMany({
        where: { publicId, installVerifiedAt: null },
        data: { installVerifiedAt: new Date(), installVerifiedHost: host },
      });
      this.cache.markInstalled(publicId);
    } catch (err) {
      this.logger.warn(
        `Couldn't record the install of ${publicId}: ${(err as Error).message}`,
      );
    }
  }
}
