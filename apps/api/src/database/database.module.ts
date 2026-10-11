import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, LlmCredential } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        ssl: config.get<boolean>('database.ssl')
          ? { rejectUnauthorized: false }
          : false,
        entities: [Conversation, LlmCredential],
        // Phase 1 (dev only): auto-sync schema from entities.
        // Replace with the SQL migrations in packages/database once the schema stabilizes.
        synchronize: config.get<string>('nodeEnv') !== 'production',
      }),
    }),
  ],
})
export class DatabaseModule {}
