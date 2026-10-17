import { Module } from '@nestjs/common';
import { WidgetPageModule } from '../widget-page/widget-page.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Platform-admin console API: workspaces, plans, suspension, audit log (M7-0). */
@Module({
  imports: [WidgetPageModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
