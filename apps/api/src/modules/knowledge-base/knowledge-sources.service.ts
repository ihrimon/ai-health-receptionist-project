import {
  type CreateTextSource,
  KNOWLEDGE_LIMITS,
  TEXT_SOURCE_TYPES,
  type UpdateTextSource,
} from '@brainstack/shared';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeSourceType } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
import { limitReached, orNotFound } from './knowledge-errors';

/** List rows leave out `content`: a page can be 50,000 characters. */
const SUMMARY_FIELDS = {
  id: true,
  type: true,
  title: true,
  fileName: true,
  fileSize: true,
  mimeType: true,
  status: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DETAIL_FIELDS = { ...SUMMARY_FIELDS, content: true } as const;

const TEXT_TYPES: KnowledgeSourceType[] = [...TEXT_SOURCE_TYPES];

/**
 * Knowledge sources (D-2 §2.3). This covers policy and text pages written
 * in the dashboard; document upload arrives with M2-10. A saved or edited
 * page waits as QUEUED until indexing (M2-11/M2-13) picks it up.
 */
@Injectable()
export class KnowledgeSourcesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly chatbot: ChatbotService,
  ) {}

  async list(type?: KnowledgeSourceType) {
    const chatbotId = await this.chatbot.currentId();
    return this.db.knowledgeSource.findMany({
      where: { chatbotId, ...(type && { type }) },
      select: SUMMARY_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const chatbotId = await this.chatbot.currentId();
    const source = await this.db.knowledgeSource.findFirst({
      where: { id, chatbotId },
      select: DETAIL_FIELDS,
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    return source;
  }

  async createText(input: CreateTextSource) {
    const chatbotId = await this.chatbot.currentId();
    // Count-then-insert; see FaqsService.create.
    const count = await this.db.knowledgeSource.count({
      where: { chatbotId, type: { in: TEXT_TYPES } },
    });
    if (count >= KNOWLEDGE_LIMITS.textSources) {
      throw limitReached('policy and text pages', KNOWLEDGE_LIMITS.textSources);
    }
    return this.db.knowledgeSource.create({
      data: { workspaceId: requireTenant().workspaceId, chatbotId, ...input },
      select: DETAIL_FIELDS,
    });
  }

  /** Edits a policy/text page and queues it for re-indexing (FR-7.5). */
  async updateText(id: string, input: UpdateTextSource) {
    const chatbotId = await this.chatbot.currentId();
    const source = await this.db.knowledgeSource.findFirst({
      where: { id, chatbotId },
      select: { type: true },
    });
    if (!source) throw new NotFoundException('Knowledge source not found');
    if (!TEXT_TYPES.includes(source.type)) {
      throw new BadRequestException(
        'Only policy and text pages can be edited; upload the document again',
      );
    }
    return orNotFound('Knowledge source', () =>
      this.db.knowledgeSource.update({
        where: { id, chatbotId },
        data: { ...input, status: 'QUEUED', error: null },
        select: DETAIL_FIELDS,
      }),
    );
  }

  /** Deletes a source. Its chunks and file go too, once those exist (M2-11). */
  async remove(id: string): Promise<void> {
    const chatbotId = await this.chatbot.currentId();
    await orNotFound('Knowledge source', () =>
      this.db.knowledgeSource.delete({
        where: { id, chatbotId },
        select: { id: true },
      }),
    );
  }
}
