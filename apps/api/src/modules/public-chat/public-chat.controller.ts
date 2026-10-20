import {
  type PublicConversationRequest,
  publicConversationRequestSchema,
  type PublicLeadRequest,
  publicLeadRequestSchema,
  type PublicMessageRequest,
  publicMessageRequestSchema,
  type PublicRatingRequest,
  publicRatingRequestSchema,
} from '@brainstack/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { streamChat } from '../../common/sse';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { Public } from '../auth/auth-context';
import { PublicChatService } from './public-chat.service';

/** `Authorization: Bearer <conversationToken>`, or null. */
function bearer(req: Request): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/**
 * The embeddable widget (D-2 §3): no login. A missing, unpublished or
 * switched-off chatbot is a 404; a conversation needs its token (401).
 * The answer streams as SSE (M3-3).
 */
@Controller('public')
@Public()
export class PublicChatController {
  constructor(private readonly chat: PublicChatService) {}

  @Get('chatbots/:publicId/config')
  config(@Param('publicId') publicId: string) {
    return this.chat.config(publicId);
  }

  @Post('chatbots/:publicId/conversations')
  startConversation(
    @Param('publicId') publicId: string,
    @Req() req: Request,
    @Body(new ZodBodyPipe(publicConversationRequestSchema))
    body: PublicConversationRequest,
  ) {
    return this.chat.startConversation(publicId, req.ip ?? 'unknown', body);
  }

  /** Streams the answer as Server-Sent Events (D-2 §3.2). */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Body(new ZodBodyPipe(publicMessageRequestSchema))
    body: PublicMessageRequest,
  ): Promise<void> {
    await streamChat(res, (emit) =>
      this.chat.send(id, bearer(req), req.ip ?? 'unknown', body, emit),
    );
  }

  @Get('conversations/:id/messages')
  history(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.chat.history(id, bearer(req));
  }

  /** 204; the token must be this conversation's (401 otherwise). */
  @Post('conversations/:id/rating')
  @HttpCode(HttpStatus.NO_CONTENT)
  rate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Body(new ZodBodyPipe(publicRatingRequestSchema))
    body: PublicRatingRequest,
  ) {
    return this.chat.rate(id, bearer(req), body);
  }

  /**
   * 204: the widget's contact form saves a lead in this conversation (M7-41).
   * The token must be this conversation's (401 otherwise).
   */
  @Post('conversations/:id/lead')
  @HttpCode(HttpStatus.NO_CONTENT)
  lead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Body(new ZodBodyPipe(publicLeadRequestSchema))
    body: PublicLeadRequest,
  ) {
    return this.chat.submitLead(id, bearer(req), req.ip ?? 'unknown', body);
  }
}
