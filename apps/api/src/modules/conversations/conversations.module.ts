import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/** Stored chats and their messages, per workspace (M3-5, M3-11). */
@Module({
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
