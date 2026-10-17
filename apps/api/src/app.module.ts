import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { LlmCredentialsModule } from './modules/llm-credentials/llm-credentials.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { ProductsModule } from './modules/products/products.module';
import { PreviewChatModule } from './modules/preview-chat/preview-chat.module';
import { LlmKeysModule } from './modules/llm-keys/llm-keys.module';
import { PublicChatModule } from './modules/public-chat/public-chat.module';
import { UsageModule } from './modules/usage/usage.module';
import { WidgetPageModule } from './modules/widget-page/widget-page.module';
import { LeadsModule } from './modules/leads/leads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    QueueModule,
    StorageModule,
    RateLimitModule,
    TenancyModule,
    HealthModule,
    AuthModule,
    LlmCredentialsModule,
    WorkspacesModule,
    ChatbotModule,
    KnowledgeBaseModule,
    ProductsModule,
    PreviewChatModule,
    LlmKeysModule,
    PublicChatModule,
    UsageModule,
    WidgetPageModule,
    LeadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
