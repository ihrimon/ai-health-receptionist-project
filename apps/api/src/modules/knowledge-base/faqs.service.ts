import {
  type CreateFaq,
  KNOWLEDGE_LIMITS,
  type UpdateFaq,
} from '@brainstack/shared';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
import { limitReached, orNotFound } from './knowledge-errors';

const FAQ_FIELDS = {
  id: true,
  question: true,
  answer: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The chatbot's FAQs (D-2 §2.3). Saved FAQs are live right away; indexing
 * them for search arrives with M2-13.
 */
@Injectable()
export class FaqsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly chatbot: ChatbotService,
  ) {}

  async list() {
    const chatbotId = await this.chatbot.currentId();
    return this.db.faq.findMany({
      where: { chatbotId },
      select: FAQ_FIELDS,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Adds an FAQ at the end of the list. */
  async create(input: CreateFaq) {
    const chatbotId = await this.chatbot.currentId();
    // Count-then-insert: two creates racing at the limit can both pass.
    // Being one over the MVP cap is harmless.
    const [count, last] = await Promise.all([
      this.db.faq.count({ where: { chatbotId } }),
      this.db.faq.aggregate({
        where: { chatbotId },
        _max: { sortOrder: true },
      }),
    ]);
    if (count >= KNOWLEDGE_LIMITS.faqs) {
      throw limitReached('FAQs', KNOWLEDGE_LIMITS.faqs);
    }
    return this.db.faq.create({
      data: {
        workspaceId: requireTenant().workspaceId,
        chatbotId,
        ...input,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
      select: FAQ_FIELDS,
    });
  }

  async update(id: string, input: UpdateFaq) {
    const chatbotId = await this.chatbot.currentId();
    return orNotFound('FAQ', () =>
      this.db.faq.update({
        where: { id, chatbotId },
        data: input,
        select: FAQ_FIELDS,
      }),
    );
  }

  async remove(id: string): Promise<void> {
    const chatbotId = await this.chatbot.currentId();
    await orNotFound('FAQ', () =>
      this.db.faq.delete({ where: { id, chatbotId }, select: { id: true } }),
    );
  }

  /**
   * Sets the display order. `ids` must list every FAQ of the chatbot once;
   * an ID that isn't one of them (another workspace's included) is a 404.
   */
  async reorder(ids: string[]) {
    const chatbotId = await this.chatbot.currentId();
    await this.db.$transaction(async (tx) => {
      const existing = await tx.faq.findMany({
        where: { chatbotId },
        select: { id: true },
      });
      const known = new Set(existing.map((f) => f.id));
      if (ids.some((id) => !known.has(id))) {
        throw new NotFoundException('FAQ not found');
      }
      if (ids.length !== known.size) {
        throw new BadRequestException('Include every FAQ in the new order');
      }
      for (const [sortOrder, id] of ids.entries()) {
        await tx.faq.update({ where: { id }, data: { sortOrder } });
      }
    });
    return this.list();
  }
}
