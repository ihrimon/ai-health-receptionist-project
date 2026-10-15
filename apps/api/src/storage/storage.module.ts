import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3_CLIENT, StorageService } from './storage.service';

/**
 * File storage for uploads (documents M2-10, chatbot images later). The
 * S3 client is lazy: nothing connects until the first file operation.
 */
@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({
          endpoint: config.get<string>('storage.endpoint'),
          region: config.get<string>('storage.region'),
          forcePathStyle: config.get<boolean>('storage.forcePathStyle'),
          credentials: {
            accessKeyId: config.getOrThrow<string>('storage.accessKeyId'),
            secretAccessKey: config.getOrThrow<string>(
              'storage.secretAccessKey',
            ),
          },
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
