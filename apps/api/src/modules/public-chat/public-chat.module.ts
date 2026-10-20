import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { LeadsModule } from '../leads/leads.module';
import { PreviewChatModule } from '../preview-chat/preview-chat.module';
import { ConversationTokenService } from './conversation-token.service';
import { PublicChatController } from './public-chat.controller';
import { PublicChatService } from './public-chat.service';

/** The embeddable widget's API (M3-3, M3-4, M4). */
@Module({
  imports: [ConversationsModule, LeadsModule, PreviewChatModule],
  controllers: [PublicChatController],
  providers: [PublicChatService, ConversationTokenService],
})
export class PublicChatModule {}
