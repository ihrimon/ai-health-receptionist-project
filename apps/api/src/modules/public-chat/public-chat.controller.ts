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
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { Public } from '../auth/auth-context';
import { PublicChatService } from './public-chat.service';

/**
 * The embeddable widget (early MVP): no login. A missing, unpublished or
 * switched-off chatbot is a 404. JSON for now; SSE comes with M3-3.
 */
@Controller('public/chatbots/:publicId')
@Public()
export class PublicChatController {
  constructor(private readonly chat: PublicChatService) {}

  @Get('config')
  config(@Param('publicId') publicId: string) {
    return this.chat.config(publicId);
  }

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  send(
    @Param('publicId') publicId: string,
    @Req() req: Request,
    @Body(new ZodBodyPipe(previewChatRequestSchema)) body: PreviewChatRequest,
  ) {
    return this.chat.send(publicId, req.ip ?? 'unknown', body);
  }
}
