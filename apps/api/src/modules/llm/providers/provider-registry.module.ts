import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry';

/**
 * Split out from ChatModule so LlmCredentialsModule can also depend on
 * ProviderRegistry (to validate a credential's provider/key/model combo
 * on create/update) without the two modules importing each other.
 */
@Module({
  providers: [ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProviderRegistryModule {}
