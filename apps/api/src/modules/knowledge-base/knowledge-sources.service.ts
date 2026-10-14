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
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeSourceType } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { StorageService } from '../../storage/storage.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { checkDocumentFile, titleFromFileName } from './document-file';
import { limitReached, orNotFound } from './knowledge-errors';

/** An uploaded file as the controller hands it over. */
export interface DocumentUpload {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

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
 * Knowledge sources (D-2 §2.3): policy and text pages written in the
 * dashboard, and uploaded documents (M2-10). A new or edited source waits
 * as QUEUED until indexing (M2-11/M2-13) picks it up.
 */
@Injectable()
export class KnowledgeSourcesService {
  private readonly logger = new Logger(KnowledgeSourcesService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly chatbot: ChatbotService,
    private readonly storage: StorageService,
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

  /**
   * Stores an uploaded PDF/DOCX/TXT/MD and records it as a QUEUED source
   * (M2-10). The file is checked before anything is stored; the text is
   * extracted later by indexing (M2-11).
   */
  async uploadDocument(upload: DocumentUpload, title?: string) {
    const type = checkDocumentFile(
      upload.originalName,
      upload.mimeType,
      upload.buffer,
    );
    const chatbotId = await this.chatbot.currentId();
    // Count-then-insert; see FaqsService.create.
    const count = await this.db.knowledgeSource.count({
      where: { chatbotId, type: 'DOCUMENT' },
    });
    if (count >= KNOWLEDGE_LIMITS.documents) {
      throw limitReached('documents', KNOWLEDGE_LIMITS.documents);
    }

    const fileKey = await this.storage.put(
      'documents',
      upload.originalName,
      upload.buffer,
      type.mimeType,
    );
    try {
      return await this.db.knowledgeSource.create({
        data: {
          workspaceId: requireTenant().workspaceId,
          chatbotId,
          type: 'DOCUMENT',
          title: title ?? titleFromFileName(upload.originalName),
          fileKey,
          fileName: upload.originalName.slice(0, 255),
          fileSize: upload.buffer.length,
          mimeType: type.mimeType,
        },
        select: SUMMARY_FIELDS,
      });
    } catch (err) {
      // No row points at the file, so nothing would ever delete it.
      await this.deleteFile(fileKey);
      throw err;
    }
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

  /**
   * Deletes a source and, for a document, its stored file. The row goes
   * first: a file without a row is only wasted space, while a row without
   * its file would break indexing. Chunks go with the row once they link
   * to it (M2-12).
   */
  async remove(id: string): Promise<void> {
    const chatbotId = await this.chatbot.currentId();
    const deleted = await orNotFound('Knowledge source', () =>
      this.db.knowledgeSource.delete({
        where: { id, chatbotId },
        select: { fileKey: true },
      }),
    );
    if (deleted.fileKey) await this.deleteFile(deleted.fileKey);
  }

  /** Best effort: a leftover file is logged, not shown to the user. */
  private async deleteFile(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(
        `Could not delete stored file ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
