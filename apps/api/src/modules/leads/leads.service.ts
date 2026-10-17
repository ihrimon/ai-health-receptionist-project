import {
  conversationRange,
  type LeadAnswer,
  type LeadExportQuery,
  type LeadInput,
  leadInputSchema,
  type LeadListQuery,
  type LeadPage,
  type LeadSummary,
} from '@brainstack/shared';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import {
  decodeCursor,
  encodeCursor,
  type ProductCursor,
} from '../products/product-cursor';
import { leadsCsv } from './lead-csv';

/** The most rows one CSV export holds; narrow the dates for more. */
export const LEAD_EXPORT_MAX = 10_000;
const EXPORT_BATCH = 500;

const LEAD_SELECT = {
  id: true,
  chatbotId: true,
  conversationId: true,
  name: true,
  email: true,
  phone: true,
  answers: true,
  sourceUrl: true,
  createdAt: true,
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_SELECT }>;

/** Per chatbot: question ID → the question's text. */
type QuestionLabels = Map<string, Map<string, string>>;

export interface CreateLead extends LeadInput {
  chatbotId: string;
  /** The chat the lead came from; one lead per conversation. */
  conversationId?: string;
}

/** Stored answers are `{ [questionId]: answer }`; anything else is dropped. */
function storedAnswers(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** The `{ id, question }` pairs of a stored ChatbotConfig, read defensively. */
function configQuestions(
  config: Prisma.JsonValue | undefined,
): [string, string][] {
  const behavior = (
    config as { behavior?: { questionsToAsk?: unknown } } | null
  )?.behavior;
  const list = behavior?.questionsToAsk;
  if (!Array.isArray(list)) return [];
  return list.flatMap((q: unknown) => {
    const { id, question } = (q ?? {}) as Record<string, unknown>;
    return typeof id === 'string' && typeof question === 'string'
      ? [[id, question] as [string, string]]
      : [];
  });
}

/**
 * Leads (D-2 §2.6, M5-5, FR-8.2). Everything goes through the tenant
 * client, so another workspace's leads, chatbots and conversations simply
 * don't exist here (404).
 */
@Injectable()
export class LeadsService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /**
   * Saves a lead for the current workspace; the capture_lead tool (M5-4)
   * calls this. A conversation has at most one lead: capturing again in
   * the same chat fills in the new fields and answers instead of adding a
   * second row. The source page is copied from the conversation so it
   * outlives a deleted chat.
   */
  async create(input: CreateLead, retried = false): Promise<LeadSummary> {
    const { chatbotId, conversationId, ...fieldsIn } = input;
    const parsed = leadInputSchema.safeParse(fieldsIn);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const fields = parsed.data;

    const chatbot = await this.db.chatbot.findFirst({
      where: { id: chatbotId },
      select: { id: true },
    });
    if (!chatbot) throw new NotFoundException('Chatbot not found');

    let sourceUrl: string | null = null;
    let existing: LeadRow | null = null;
    if (conversationId) {
      const conversation = await this.db.conversation.findFirst({
        where: { id: conversationId, chatbotId },
        select: { originUrl: true, lead: { select: LEAD_SELECT } },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');
      sourceUrl = conversation.originUrl;
      existing = conversation.lead;
    }

    try {
      const row = existing
        ? await this.db.lead.update({
            where: { id: existing.id },
            data: {
              ...(fields.name && { name: fields.name }),
              ...(fields.email && { email: fields.email }),
              ...(fields.phone && { phone: fields.phone }),
              answers: {
                ...storedAnswers(existing.answers),
                ...fields.answers,
              },
            },
            select: LEAD_SELECT,
          })
        : await this.db.lead.create({
            data: {
              workspaceId: requireTenant().workspaceId,
              chatbotId,
              conversationId: conversationId ?? null,
              name: fields.name ?? null,
              email: fields.email ?? null,
              phone: fields.phone ?? null,
              answers: fields.answers ?? {},
              sourceUrl,
            },
            select: LEAD_SELECT,
          });
      const labels = await this.questionLabels([row.chatbotId]);
      return this.toSummary(row, labels);
    } catch (err) {
      // Two captures in the same chat at once: the second one merges.
      if (
        !retried &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.create(input, true);
      }
      throw err;
    }
  }

  /** Newest first, `limit` per page; `nextCursor` is null on the last page. */
  async list(query: LeadListQuery): Promise<LeadPage> {
    const rows = await this.db.lead.findMany({
      where: this.where(
        query,
        query.cursor ? decodeCursor(query.cursor) : undefined,
      ),
      select: LEAD_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const labels = await this.questionLabels(items.map((r) => r.chatbotId));
    const last = items.at(-1);
    return {
      items: items.map((row) => this.toSummary(row, labels)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  /**
   * Every lead matching the filters (no paging), newest first, as CSV
   * (FR-8.2). At most LEAD_EXPORT_MAX rows.
   */
  async exportCsv(query: LeadExportQuery): Promise<string> {
    const rows: LeadRow[] = [];
    let after: ProductCursor | undefined;
    while (rows.length < LEAD_EXPORT_MAX) {
      const batch = await this.db.lead.findMany({
        where: this.where(query, after),
        select: LEAD_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(EXPORT_BATCH, LEAD_EXPORT_MAX - rows.length),
      });
      rows.push(...batch);
      const last = batch.at(-1);
      if (batch.length < EXPORT_BATCH || !last) break;
      after = { createdAt: last.createdAt, id: last.id };
    }
    const labels = await this.questionLabels(rows.map((r) => r.chatbotId));
    return leadsCsv(rows.map((row) => this.toSummary(row, labels)));
  }

  /** Another workspace's lead is a 404. */
  async remove(id: string): Promise<void> {
    const deleted = await this.db.lead.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new NotFoundException('Lead not found');
  }

  private where(
    query: LeadExportQuery,
    after: ProductCursor | undefined,
  ): Prisma.LeadWhereInput {
    const filters: Prisma.LeadWhereInput[] = [];
    if (query.chatbotId) filters.push({ chatbotId: query.chatbotId });
    const { from, to } = conversationRange(query);
    if (from) filters.push({ createdAt: { gte: from } });
    if (to) filters.push({ createdAt: { lt: to } });
    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' } as const;
      filters.push({
        OR: [{ name: contains }, { email: contains }, { phone: contains }],
      });
    }
    if (after) {
      filters.push({
        OR: [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ],
      });
    }
    return { AND: filters };
  }

  /**
   * The question texts of these chatbots, from the live config and then
   * the draft (the draft wins), so an answer shows the question it
   * answers even after the config changed.
   */
  private async questionLabels(chatbotIds: string[]): Promise<QuestionLabels> {
    const ids = [...new Set(chatbotIds)];
    const labels: QuestionLabels = new Map();
    if (ids.length === 0) return labels;
    const bots = await this.db.chatbot.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        draftConfig: true,
        publishedVersion: { select: { config: true } },
      },
    });
    for (const bot of bots) {
      labels.set(
        bot.id,
        new Map([
          ...configQuestions(bot.publishedVersion?.config),
          ...configQuestions(bot.draftConfig),
        ]),
      );
    }
    return labels;
  }

  private toSummary(row: LeadRow, labels: QuestionLabels): LeadSummary {
    const questions = labels.get(row.chatbotId);
    const answers: LeadAnswer[] = Object.entries(
      storedAnswers(row.answers),
    ).map(([questionId, answer]) => ({
      questionId,
      question: questions?.get(questionId) ?? null,
      answer,
    }));
    return {
      id: row.id,
      chatbotId: row.chatbotId,
      conversationId: row.conversationId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      answers,
      sourceUrl: row.sourceUrl,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
