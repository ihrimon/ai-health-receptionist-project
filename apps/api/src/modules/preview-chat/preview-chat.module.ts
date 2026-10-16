import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmKeysModule } from '../llm-keys/llm-keys.module';
import { LlmModule } from '../llm/llm.module';
import { UsageModule } from '../usage/usage.module';
import { PreviewChatController } from './preview-chat.controller';
import { ProductToolsService } from './product-tools.service';
import { PreviewChatService } from './preview-chat.service';

/** Dashboard "Test chat" over the workspace's knowledge (M3-13, M3-14). */
@Module({
  imports: [
    ConversationsModule,
    LlmModule,
    ChatbotModule,
    KnowledgeModule,
    LlmKeysModule,
    UsageModule,
  ],
  controllers: [PreviewChatController],
  providers: [PreviewChatService, ProductToolsService],
  exports: [PreviewChatService],
})
export class PreviewChatModule {}
