import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmKeysModule } from '../llm-keys/llm-keys.module';
import { LlmModule } from '../llm/llm.module';
import { PreviewChatController } from './preview-chat.controller';
import { PreviewChatService } from './preview-chat.service';

/** Dashboard "Test chat" over the workspace's knowledge (M3-13, M3-14). */
@Module({
  imports: [LlmModule, ChatbotModule, KnowledgeModule, LlmKeysModule],
  controllers: [PreviewChatController],
  providers: [PreviewChatService],
  exports: [PreviewChatService],
})
export class PreviewChatModule {}
