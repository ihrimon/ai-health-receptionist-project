import { Module } from '@nestjs/common';
import { SecretBox } from '../../common/secret-box';
import { ChatModule } from '../chat/chat.module';
import { LlmKeysController } from './llm-keys.controller';
import { LlmKeysService } from './llm-keys.service';

/** A workspace's own LLM API keys (M3-21). */
@Module({
  imports: [ChatModule],
  controllers: [LlmKeysController],
  providers: [LlmKeysService, SecretBox],
  exports: [LlmKeysService],
})
export class LlmKeysModule {}
