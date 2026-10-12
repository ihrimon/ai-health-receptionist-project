import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/auth-context';
import { PlatformAdminOnly } from '../auth/platform-admin.guard';
import { ChatService } from './chat.service';
import { RateConversationDto } from './dto/rate-conversation.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { LlmKeyManager } from './llm-key-manager';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly llmKeyManager: LlmKeyManager,
  ) {}

  // Interim public demo chat (/chat page); the widget API replaces it in M3.
  @Public()
  @Post('message')
  sendMessage(@Body() dto: SendChatMessageDto) {
    return this.chatService.sendMessage(dto);
  }

  @Public()
  @Post(':sessionId/rating')
  rateConversation(
    @Param('sessionId') sessionId: string,
    @Body() dto: RateConversationDto,
  ) {
    return this.chatService.rateConversation(sessionId, dto.rating);
  }

  /**
   * Which configured credential (Settings page) LlmKeyManager's in-memory
   * rotation is currently pointed at — lets the Settings page show a live
   * "currently active" badge instead of an admin having to infer it from
   * Render logs or lastUsedAt timestamps. Platform-admin only: this is operational
   * insight into the server's live rotation state, not something a chat
   * visitor needs. Lives here (not llm-credentials) because LlmKeyManager
   * is a ChatModule provider — putting this endpoint in
   * LlmCredentialsController would need LlmCredentialsModule to import
   * ChatModule, which already imports LlmCredentialsModule (circular).
   */
  @Get('active-credential')
  @PlatformAdminOnly()
  async activeCredential(): Promise<{ id: string | null }> {
    const credential = await this.llmKeyManager.getCurrentCredential();
    return { id: credential?.id ?? null };
  }
}
