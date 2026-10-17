import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { HiddenPlatformAdminOnly } from '../auth/platform-admin.guard';
import { AdminService } from './admin.service';
import {
  AuditLogQueryDto,
  ListWorkspacesQueryDto,
  UpdateWorkspaceDto,
} from './dto/admin.dto';

/**
 * D-2 §2.8: the platform team's console. Every route needs
 * `users.is_platform_admin` and answers 404 to anyone else. No
 * `@Roles()`: these routes are not workspace data on purpose.
 */
@Controller('admin')
@HiddenPlatformAdminOnly()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('workspaces')
  listWorkspaces(@Query() query: ListWorkspacesQueryDto) {
    return this.admin.listWorkspaces(query);
  }

  @Patch('workspaces/:id')
  updateWorkspace(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.admin.updateWorkspace(
      { id: user.id, email: user.email },
      id,
      dto,
    );
  }

  @Get('audit-log')
  auditLog(@Query() query: AuditLogQueryDto) {
    return this.admin.auditLog(query);
  }
}
