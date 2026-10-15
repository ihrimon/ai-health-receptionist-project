import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PreviewChatController } from './preview-chat.controller';
import { PreviewChatService } from './preview-chat.service';

/** Dashboard "Test chat" over the workspace's knowledge (M3-13, M3-14). */
@Module({
  imports: [ChatModule, ChatbotModule, KnowledgeModule],
  controllers: [PreviewChatController],
  providers: [PreviewChatService],
})
export class PreviewChatModule {}
