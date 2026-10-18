import { Module } from '@nestjs/common';
import { SecretBox } from '../../common/secret-box';
import { AuthModule } from '../auth/auth.module';
import { ProviderRegistryModule } from '../llm/providers/provider-registry.module';
import { LlmCredentialsController } from './llm-credentials.controller';
import { LlmCredentialsService } from './llm-credentials.service';

@Module({
  imports: [AuthModule, ProviderRegistryModule],
  controllers: [LlmCredentialsController],
  providers: [LlmCredentialsService, SecretBox],
  exports: [LlmCredentialsService],
})
export class LlmCredentialsModule {}
