import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProviderRegistryModule } from '../chat/providers/provider-registry.module';
import { LlmCredentialsController } from './llm-credentials.controller';
import { LlmCredentialsService } from './llm-credentials.service';

@Module({
  imports: [AuthModule, ProviderRegistryModule],
  controllers: [LlmCredentialsController],
  providers: [LlmCredentialsService],
  exports: [LlmCredentialsService],
})
export class LlmCredentialsModule {}
