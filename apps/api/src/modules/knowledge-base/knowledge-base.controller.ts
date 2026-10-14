import {
  type CreateCustomAnswer,
  createCustomAnswerSchema,
  type CreateFaq,
  createFaqSchema,
  type CreateTextSource,
  createTextSourceSchema,
  type FaqOrder,
  faqOrderSchema,
  type UpdateCustomAnswer,
  updateCustomAnswerSchema,
  type UpdateFaq,
  updateFaqSchema,
  type UpdateTextSource,
  updateTextSourceSchema,
  DOCUMENT_MAX_BYTES,
  type UploadDocument,
  uploadDocumentSchema,
} from '@brainstack/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import {
  KnowledgeSourceType,
  WorkspaceRole,
} from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { CustomAnswersService } from './custom-answers.service';
import { FaqsService } from './faqs.service';
import { KnowledgeSourcesService } from './knowledge-sources.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** D-2 §2.3: FAQs. Viewers read, admins write. */
@Controller('faqs')
export class FaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  list() {
    return this.faqs.list();
  }

  @Post()
  @Roles(WorkspaceRole.ADMIN)
  create(@Body(new ZodBodyPipe(createFaqSchema)) body: CreateFaq) {
    return this.faqs.create(body);
  }

  // Declared before ':id' so "order" isn't read as an FAQ ID.
  @Put('order')
  @Roles(WorkspaceRole.ADMIN)
  reorder(@Body(new ZodBodyPipe(faqOrderSchema)) body: FaqOrder) {
    return this.faqs.reorder(body.ids);
  }

  @Patch(':id')
  @Roles(WorkspaceRole.ADMIN)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodBodyPipe(updateFaqSchema)) body: UpdateFaq,
  ) {
    return this.faqs.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(WorkspaceRole.ADMIN)
  remove(@Param('id', uuid) id: string) {
    return this.faqs.remove(id);
  }
}

/** D-2 §2.3: custom answers. */
@Controller('custom-answers')
export class CustomAnswersController {
  constructor(private readonly customAnswers: CustomAnswersService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  list() {
    return this.customAnswers.list();
  }

  @Post()
  @Roles(WorkspaceRole.ADMIN)
  create(
    @Body(new ZodBodyPipe(createCustomAnswerSchema)) body: CreateCustomAnswer,
  ) {
    return this.customAnswers.create(body);
  }

  @Patch(':id')
  @Roles(WorkspaceRole.ADMIN)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodBodyPipe(updateCustomAnswerSchema)) body: UpdateCustomAnswer,
  ) {
    return this.customAnswers.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(WorkspaceRole.ADMIN)
  remove(@Param('id', uuid) id: string) {
    return this.customAnswers.remove(id);
  }
}

/**
 * D-2 §2.3: knowledge sources: policy and text pages, and uploaded
 * documents. Reindex arrives with M2-11.
 */
@Controller('knowledge-sources')
export class KnowledgeSourcesController {
  constructor(private readonly sources: KnowledgeSourcesService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  list(
    @Query('type', new ParseEnumPipe(KnowledgeSourceType, { optional: true }))
    type?: KnowledgeSourceType,
  ) {
    return this.sources.list(type);
  }

  @Get(':id')
  @Roles(WorkspaceRole.VIEWER)
  get(@Param('id', uuid) id: string) {
    return this.sources.get(id);
  }

  @Post()
  @Roles(WorkspaceRole.ADMIN)
  create(
    @Body(new ZodBodyPipe(createTextSourceSchema)) body: CreateTextSource,
  ) {
    return this.sources.createText(body);
  }

  /**
   * Document upload (M2-10): `file` plus an optional `title`. 202, as the
   * text is extracted and indexed later (M2-11). Over 10 MB is a 413.
   */
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(WorkspaceRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodBodyPipe(uploadDocumentSchema)) body: UploadDocument,
  ) {
    if (!file) {
      throw new BadRequestException('Attach the document as the "file" field');
    }
    return this.sources.uploadDocument(
      {
        // Multer reads the name as Latin-1; browsers send UTF-8.
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        mimeType: file.mimetype,
        buffer: file.buffer,
      },
      body.title,
    );
  }

  @Patch(':id')
  @Roles(WorkspaceRole.ADMIN)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodBodyPipe(updateTextSourceSchema)) body: UpdateTextSource,
  ) {
    return this.sources.updateText(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(WorkspaceRole.ADMIN)
  remove(@Param('id', uuid) id: string) {
    return this.sources.remove(id);
  }
}
