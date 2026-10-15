import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { LlmCredentialsModule } from '../llm-credentials/llm-credentials.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmChatClient } from './llm-chat.client';
import { LlmKeyManager } from './llm-key-manager';
import { ProviderRegistryModule } from './providers/provider-registry.module';

@Module({
  imports: [
    ConversationsModule,
    LlmCredentialsModule,
    ProviderRegistryModule,
    AuthModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, LlmChatClient, LlmKeyManager],
  exports: [LlmChatClient],
})
export class ChatModule {}
