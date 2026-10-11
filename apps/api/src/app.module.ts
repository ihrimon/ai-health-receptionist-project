import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ChatModule } from './modules/chat/chat.module';
import { AuthModule } from './modules/auth/auth.module';
import { LlmCredentialsModule } from './modules/llm-credentials/llm-credentials.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    QueueModule,
    HealthModule,
    ConversationsModule,
    ChatModule,
    AuthModule,
    LlmCredentialsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
