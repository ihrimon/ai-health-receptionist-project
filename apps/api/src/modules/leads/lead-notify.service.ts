import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkspaceRole } from '../../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { EmailService } from '../email/email.service';
import { leadEmailHtml, leadEmailSubject } from './lead-email';
import { LeadsService } from './leads.service';

/** What one notify run did; the worker logs it and tests check it. */
export type LeadNotifyResult =
  | 'sent'
  /** No such lead here, or a Test chat (preview) lead. */
  | 'skipped'
  /** Already emailed (by this job's earlier attempt or another job). */
  | 'already-notified'
  /** No owner with a confirmed email address. */
  | 'no-recipients'
  /** Email isn't configured; nothing was sent, nothing to retry. */
  | 'email-disabled';

/** identity.botName of a stored ChatbotConfig, read defensively. */
function botNameOf(config: Prisma.JsonValue | undefined): string | null {
  const name = (config as { identity?: { botName?: unknown } } | null)?.identity
    ?.botName;
  return typeof name === 'string' && name.trim() ? name : null;
}

/**
 * Emails the workspace owners about a new lead (M5-6, FR-8.7, decision
 * B9). Runs in the lead's workspace context (set by the worker), so only
 * that workspace's lead and owners are found. At most one email per lead:
 * `leads.notified_at` is claimed before sending and given back if the send
 * fails, so a retry can try again but two jobs never both send.
 */
@Injectable()
export class LeadNotifyService {
  private readonly logger = new Logger(LeadNotifyService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly leads: LeadsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** Throws when the send fails, so the job queue retries it. */
  async notify(leadId: string): Promise<LeadNotifyResult> {
    const row = await this.db.lead.findFirst({
      where: { id: leadId },
      select: {
        notifiedAt: true,
        conversation: { select: { isPreview: true } },
        chatbot: {
          select: {
            draftConfig: true,
            publishedVersion: { select: { config: true } },
          },
        },
      },
    });
    // Test chat never saves leads (M5-4); checked again in case it ever does.
    if (!row || row.conversation?.isPreview) return 'skipped';
    if (row.notifiedAt) return 'already-notified';

    // No notification settings exist yet, so every owner with a confirmed
    // email address gets it (decision M5-6).
    const owners = await this.db.workspaceMember.findMany({
      where: {
        role: WorkspaceRole.OWNER,
        user: { emailVerifiedAt: { not: null } },
      },
      select: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const to = owners.map((o) => o.user.email);
    if (to.length === 0) return 'no-recipients';

    const claimed = await this.db.lead.updateMany({
      where: { id: leadId, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
    if (claimed.count === 0) return 'already-notified';

    try {
      // Read after the claim: the email has the details as they are now,
      // including any the visitor added while the job waited.
      const lead = await this.leads.summary(leadId);
      if (!lead) return 'skipped'; // Deleted meanwhile.
      const input = {
        lead,
        botName:
          botNameOf(row.chatbot.publishedVersion?.config) ??
          botNameOf(row.chatbot.draftConfig) ??
          'Your chatbot',
        dashboardUrl:
          this.config.get<string>('dashboardUrl') ?? 'http://localhost:3000',
      };
      const sent = await this.email.send({
        to,
        subject: leadEmailSubject(input),
        html: leadEmailHtml(input),
      });
      if (!sent) {
        await this.release(leadId);
        return 'email-disabled';
      }
      return 'sent';
    } catch (err) {
      await this.release(leadId);
      throw err;
    }
  }

  /** Gives the claim back so a retry can send. */
  private async release(leadId: string): Promise<void> {
    try {
      await this.db.lead.updateMany({
        where: { id: leadId },
        data: { notifiedAt: null },
      });
    } catch (err) {
      this.logger.error(
        `Could not release the email claim on lead ${leadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
