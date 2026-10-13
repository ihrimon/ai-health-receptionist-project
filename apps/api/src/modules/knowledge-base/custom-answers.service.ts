import {
  type CreateCustomAnswer,
  KNOWLEDGE_LIMITS,
  type UpdateCustomAnswer,
} from '@brainstack/shared';
import { Inject, Injectable } from '@nestjs/common';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
import { limitReached, orNotFound } from './knowledge-errors';

// The embedding columns are filled by indexing (M2-13) and never returned.
const CUSTOM_ANSWER_FIELDS = {
  id: true,
  triggerQuestion: true,
  answer: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** "When asked X, answer exactly Y" (FR-2.6), live on save. */
@Injectable()
export class CustomAnswersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly chatbot: ChatbotService,
  ) {}

  async list() {
    const chatbotId = await this.chatbot.currentId();
    return this.db.customAnswer.findMany({
      where: { chatbotId },
      select: CUSTOM_ANSWER_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(input: CreateCustomAnswer) {
    const chatbotId = await this.chatbot.currentId();
    // Count-then-insert; see FaqsService.create.
    const count = await this.db.customAnswer.count({ where: { chatbotId } });
    if (count >= KNOWLEDGE_LIMITS.customAnswers) {
      throw limitReached('custom answers', KNOWLEDGE_LIMITS.customAnswers);
    }
    return this.db.customAnswer.create({
      data: { workspaceId: requireTenant().workspaceId, chatbotId, ...input },
      select: CUSTOM_ANSWER_FIELDS,
    });
  }

  async update(id: string, input: UpdateCustomAnswer) {
    const chatbotId = await this.chatbot.currentId();
    return orNotFound('Custom answer', () =>
      this.db.customAnswer.update({
        where: { id, chatbotId },
        data: input,
        select: CUSTOM_ANSWER_FIELDS,
      }),
    );
  }

  async remove(id: string): Promise<void> {
    const chatbotId = await this.chatbot.currentId();
    await orNotFound('Custom answer', () =>
      this.db.customAnswer.delete({
        where: { id, chatbotId },
        select: { id: true },
      }),
    );
  }
}
