import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
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
 * and text pages. Not to be confused with modules/knowledge, the interim
 * single-tenant RAG search that M2-11 replaces.
 */
@Module({
  imports: [ChatbotModule],
  controllers: [
    FaqsController,
    CustomAnswersController,
    KnowledgeSourcesController,
  ],
  providers: [FaqsService, CustomAnswersService, KnowledgeSourcesService],
})
export class KnowledgeBaseModule {}
