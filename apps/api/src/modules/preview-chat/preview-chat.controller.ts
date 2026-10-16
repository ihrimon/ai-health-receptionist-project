import {
  type PreviewChatRequest,
  previewChatRequestSchema,
} from '@brainstack/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { streamChat } from '../../common/sse';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth } from '../auth/auth-context';
import { PreviewChatService } from './preview-chat.service';

/** D-2 §2.5: the answer streams as Server-Sent Events (M3-3). */
@Controller('chatbot/preview')
export class PreviewChatController {
  constructor(private readonly preview: PreviewChatService) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.VIEWER)
  async send(
    @CurrentAuth() auth: AuthContext,
    @Res() res: Response,
    @Body(new ZodBodyPipe(previewChatRequestSchema)) body: PreviewChatRequest,
  ): Promise<void> {
    await streamChat(res, (emit) =>
      this.preview.send(auth.user.id, body, emit),
    );
  }
}
