import {
  type PreviewChatRequest,
  previewChatRequestSchema,
} from '@brainstack/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { streamChat } from '../../common/sse';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { Public } from '../auth/auth-context';
import { PublicChatService } from './public-chat.service';

/**
 * The embeddable widget (early MVP): no login. A missing, unpublished or
 * switched-off chatbot is a 404. The answer streams as SSE (M3-3).
 */
@Controller('public/chatbots/:publicId')
@Public()
export class PublicChatController {
  constructor(private readonly chat: PublicChatService) {}

  @Get('config')
  config(@Param('publicId') publicId: string) {
    return this.chat.config(publicId);
  }

  /** Streams the answer as Server-Sent Events (D-2 §3.2). */
  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async send(
    @Param('publicId') publicId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Body(new ZodBodyPipe(previewChatRequestSchema)) body: PreviewChatRequest,
  ): Promise<void> {
    await streamChat(res, (emit) =>
      this.chat.send(publicId, req.ip ?? 'unknown', body, emit),
    );
  }
}
