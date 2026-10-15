import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CustomAnswersService } from './custom-answers.service';
import {
  CustomAnswersController,
  FaqsController,
  KnowledgeSourcesController,
} from './knowledge-base.controller';
import { FaqsService } from './faqs.service';
import { KnowledgeSourcesService } from './knowledge-sources.service';

/**
 * The company-managed knowledge base (M2-6): FAQs, custom answers, policy
 * and text pages, uploaded documents. Indexing and search live in
 * modules/knowledge.
 */
@Module({
  imports: [ChatbotModule, KnowledgeModule],
  controllers: [
    FaqsController,
    CustomAnswersController,
    KnowledgeSourcesController,
  ],
  providers: [FaqsService, CustomAnswersService, KnowledgeSourcesService],
})
export class KnowledgeBaseModule {}
