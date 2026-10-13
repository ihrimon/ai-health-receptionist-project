import { type ChatbotConfig, chatbotConfigSchema } from '@brainstack/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth } from '../auth/auth-context';
import { ChatbotService } from './chatbot.service';
import { SetAllowedDomainsDto, SetChatbotStatusDto } from './dto/chatbot.dto';

/**
 * D-2 §2.2. One bot per workspace (B2), so `/v1/chatbot` means the current
 * workspace's bot; `/v1/chatbots/:id` comes with multi-bot support.
 */
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  get() {
    return this.chatbot.get();
  }

  @Put('draft')
  @Roles(WorkspaceRole.ADMIN)
  saveDraft(@Body(new ZodBodyPipe(chatbotConfigSchema)) draft: ChatbotConfig) {
    return this.chatbot.saveDraft(draft);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  publish(@CurrentAuth() auth: AuthContext) {
    return this.chatbot.publish(auth.user.id);
  }

  @Post('discard-draft')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  discardDraft() {
    return this.chatbot.discardDraft();
  }

  @Patch('status')
  @Roles(WorkspaceRole.ADMIN)
  setStatus(@Body() dto: SetChatbotStatusDto) {
    return this.chatbot.setStatus(dto.status);
  }

  @Put('allowed-domains')
  @Roles(WorkspaceRole.ADMIN)
  setAllowedDomains(@Body() dto: SetAllowedDomainsDto) {
    return this.chatbot.setAllowedDomains(dto.domains);
  }
}
