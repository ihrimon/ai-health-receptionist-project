import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { HiddenPlatformAdminOnly } from '../auth/platform-admin.guard';
import { CreateLlmCredentialDto } from './dto/create-llm-credential.dto';
import { ReorderLlmCredentialsDto } from './dto/reorder-llm-credentials.dto';
import { UpdateLlmCredentialDto } from './dto/update-llm-credential.dto';
import {
  LlmCredentialsService,
  toCredentialView,
} from './llm-credentials.service';

/**
 * Platform-admin only (D-2 §2.8, M6-13): the platform's own LLM keys (M0
 * decision B3), not any workspace's. Non-admins get a 404 like the rest of
 * `/v1/admin/*`. Responses carry a masked key only; every change is
 * audited with the acting admin and never the key.
 */
@Controller('admin/llm-credentials')
@HiddenPlatformAdminOnly()
export class LlmCredentialsController {
  constructor(private readonly llmCredentialsService: LlmCredentialsService) {}

  @Get()
  async findAll() {
    return (await this.llmCredentialsService.findAllOrdered()).map(
      toCredentialView,
    );
  }

  @Post()
  async create(
    @CurrentAuth() { user }: AuthContext,
    @Body() dto: CreateLlmCredentialDto,
  ) {
    return toCredentialView(
      await this.llmCredentialsService.create(
        { id: user.id, email: user.email },
        dto,
      ),
    );
  }

  @Patch('reorder')
  async reorder(
    @CurrentAuth() { user }: AuthContext,
    @Body() dto: ReorderLlmCredentialsDto,
  ) {
    return (
      await this.llmCredentialsService.reorder(
        { id: user.id, email: user.email },
        dto.orderedIds,
      )
    ).map(toCredentialView);
  }

  @Patch(':id')
  async update(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLlmCredentialDto,
  ) {
    return toCredentialView(
      await this.llmCredentialsService.update(
        { id: user.id, email: user.email },
        id,
        dto,
      ),
    );
  }

  @Delete(':id')
  remove(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.llmCredentialsService.remove(
      { id: user.id, email: user.email },
      id,
    );
  }
}
