import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { LlmModule } from '../llm/llm.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [ConversationsModule, LlmModule, AuthModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
