import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TRANSCRIPT },
      { name: QUEUE_NAMES.NOTIFICATION },
      { name: QUEUE_NAMES.KNOWLEDGE_INGEST },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
