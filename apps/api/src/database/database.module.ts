import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global, so feature modules can inject PrismaService without importing
 * this module. Schema and migrations live in apps/api/prisma (Prisma is the
 * single source of truth — M0 decision T15).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
