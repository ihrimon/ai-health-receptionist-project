import {
  type CreateLlmKey,
  createLlmKeySchema,
  type UpdateLlmKey,
  updateLlmKeySchema,
} from '@brainstack/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { LlmKeysService } from './llm-keys.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * The workspace's own LLM API keys (M3-21), owner only: they cost the
 * company money and unlock its chat. Responses never include a key.
 */
@Controller('llm-keys')
@Roles(WorkspaceRole.OWNER)
export class LlmKeysController {
  constructor(private readonly keys: LlmKeysService) {}

  @Get()
  list() {
    return this.keys.list();
  }

  @Post()
  create(@Body(new ZodBodyPipe(createLlmKeySchema)) body: CreateLlmKey) {
    return this.keys.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodBodyPipe(updateLlmKeySchema)) body: UpdateLlmKey,
  ) {
    return this.keys.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', uuid) id: string) {
    return this.keys.remove(id);
  }
}
