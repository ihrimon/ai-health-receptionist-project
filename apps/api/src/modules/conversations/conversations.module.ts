import { Module } from '@nestjs/common';
import { ConversationInboxService } from './conversation-inbox.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/** Stored chats and their messages, per workspace (M3-5, M3-11), and the dashboard inbox (M5-1). */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationInboxService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
