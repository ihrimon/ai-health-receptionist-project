import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { createTenantPrisma, TENANT_PRISMA } from './tenant-prisma';
import { WorkspaceAccessService } from './workspace-access.service';
import { WorkspaceGuard } from './workspace.guard';

@Global()
@Module({
  providers: [
    WorkspaceAccessService,
    WorkspaceGuard,
    {
      provide: TENANT_PRISMA,
      inject: [PrismaService],
      useFactory: createTenantPrisma,
    },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [WorkspaceAccessService, WorkspaceGuard, TENANT_PRISMA],
})
export class TenancyModule {}
