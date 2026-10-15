import { Module } from '@nestjs/common';
import { PreviewChatModule } from '../preview-chat/preview-chat.module';
import { PublicChatController } from './public-chat.controller';
import { PublicChatService } from './public-chat.service';

/** The embeddable widget's API (early MVP of M3-3 and M4). */
@Module({
  imports: [PreviewChatModule],
  controllers: [PublicChatController],
  providers: [PublicChatService],
})
export class PublicChatModule {}
