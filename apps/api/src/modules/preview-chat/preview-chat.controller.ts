import {
  type PreviewChatRequest,
  previewChatRequestSchema,
} from '@brainstack/shared';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth } from '../auth/auth-context';
import { PreviewChatService } from './preview-chat.service';

/** D-2 §2.5, without SSE for the MVP (docs/quick-decision.md, option A). */
@Controller('chatbot/preview')
export class PreviewChatController {
  constructor(private readonly preview: PreviewChatService) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.VIEWER)
  send(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBodyPipe(previewChatRequestSchema)) body: PreviewChatRequest,
  ) {
    return this.preview.send(auth.user.id, body);
  }
}
