import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { HiddenPlatformAdminOnly } from '../auth/platform-admin.guard';
import { AdminUsersService } from './admin-users.service';
import { AdminService } from './admin.service';
import {
  AuditLogQueryDto,
  DeleteWorkspaceDto,
  ListUsersQueryDto,
  ListWorkspacesQueryDto,
  UpdateUserDto,
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
  constructor(
    private readonly admin: AdminService,
    private readonly users: AdminUsersService,
  ) {}

  @Get('workspaces')
  listWorkspaces(@Query() query: ListWorkspacesQueryDto) {
    return this.admin.listWorkspaces(query);
  }

  @Get('usage')
  usageOverview() {
    return this.admin.usageOverview();
  }

  @Get('workspaces/:id/usage')
  workspaceUsage(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.workspaceUsage(id);
  }

  @Get('workspaces/:id/support-view')
  supportView(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.supportView({ id: user.id, email: user.email }, id);
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

  @Delete('workspaces/:id')
  deleteWorkspace(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteWorkspaceDto,
  ) {
    return this.admin.deleteWorkspace(
      { id: user.id, email: user.email },
      id,
      dto,
    );
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Post('users/:id/verify-email')
  verifyUserEmail(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.verifyEmail({ id: user.id, email: user.email }, id);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentAuth() { user }: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.setPlatformAdmin(
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
