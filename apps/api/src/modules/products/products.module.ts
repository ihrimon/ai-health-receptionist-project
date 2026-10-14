import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [ChatbotModule, KnowledgeModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
