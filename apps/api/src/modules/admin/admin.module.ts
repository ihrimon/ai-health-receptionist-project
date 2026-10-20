import { Module } from '@nestjs/common';
import { WidgetPageModule } from '../widget-page/widget-page.module';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminService } from './admin.service';

/**
 * Platform-admin console API: workspaces (plan, suspend, delete, support
 * view), users (verify email, platform-admin access) and the audit log
 * (M7-0, M7-35).
 */
@Module({
  imports: [WidgetPageModule],
  controllers: [AdminController],
  providers: [AdminService, AdminUsersService],
})
export class AdminModule {}
