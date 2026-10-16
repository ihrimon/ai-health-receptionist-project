import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ChatbotStatus, WorkspaceStatus } from '../../generated/prisma/client';
import { frameAncestors } from './widget-page-headers';
import { WidgetPageCache } from './widget-page.cache';

/** A chatbot's public ID ("cb_" + 16 characters); anything else is a 404 without a query. */
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Decides which sites may frame a chatbot's widget page (M4-19, D-2 §4).
 * A platform-level lookup by public ID, like the public chat API: only the
 * chatbot's own `allowedDomains` are read, never another one's.
 */
@Injectable()
export class WidgetPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: WidgetPageCache,
    private readonly config: ConfigService,
  ) {}

  /**
   * The `frame-ancestors` value for a live chatbot (published, switched
   * on, in an active workspace), or null for anything else (a 404).
   */
  async frameAncestorsFor(publicId: string): Promise<string | null> {
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
    const ancestors = frameAncestors(
      bot.allowedDomains,
      this.config.get<string>('nodeEnv') !== 'production',
    );
    this.cache.set(publicId, ancestors, generation);
    return ancestors;
  }
}
