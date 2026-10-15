import { Module } from '@nestjs/common';
import { LlmCredentialsModule } from '../llm-credentials/llm-credentials.module';
import { LlmChatClient } from './llm-chat.client';
import { LlmKeyManager } from './llm-key-manager';
import { ProviderRegistryModule } from './providers/provider-registry.module';

/** The provider-agnostic LLM layer: adapters, key rotation and the chat client (M3-1). */
@Module({
  imports: [LlmCredentialsModule, ProviderRegistryModule],
  providers: [LlmChatClient, LlmKeyManager],
  exports: [LlmChatClient, LlmKeyManager, ProviderRegistryModule],
})
export class LlmModule {}
