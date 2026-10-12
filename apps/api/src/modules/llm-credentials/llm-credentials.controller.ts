import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PlatformAdminOnly } from '../auth/platform-admin.guard';
import { CreateLlmCredentialDto } from './dto/create-llm-credential.dto';
import { ReorderLlmCredentialsDto } from './dto/reorder-llm-credentials.dto';
import { UpdateLlmCredentialDto } from './dto/update-llm-credential.dto';
import { LlmCredentialsService } from './llm-credentials.service';

/**
 * Platform-admin only — these are the platform's own LLM keys (M0
 * decision B3), not any workspace's, and this is the only place they're
 * readable.
 */
@Controller('llm-credentials')
@PlatformAdminOnly()
export class LlmCredentialsController {
  constructor(private readonly llmCredentialsService: LlmCredentialsService) {}

  @Get()
  findAll() {
    return this.llmCredentialsService.findAllOrdered();
  }

  @Post()
  create(@Body() dto: CreateLlmCredentialDto) {
    return this.llmCredentialsService.create(dto);
  }

  @Patch('reorder')
  reorder(@Body() dto: ReorderLlmCredentialsDto) {
    return this.llmCredentialsService.reorder(dto.orderedIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLlmCredentialDto) {
    return this.llmCredentialsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.llmCredentialsService.remove(id);
  }
}
