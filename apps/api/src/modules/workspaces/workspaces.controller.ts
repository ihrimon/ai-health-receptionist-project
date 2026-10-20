import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth } from '../auth/auth-context';
import { SwitchWorkspaceDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { WorkspacesService } from './workspaces.service';

@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /** D-2 §2.1: any member. Someone else's workspace is a 404. */
  @Post('workspaces/switch')
  @HttpCode(HttpStatus.NO_CONTENT)
  switch(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SwitchWorkspaceDto,
  ): Promise<void> {
    return this.workspaces.switchActive(auth, dto.workspaceId);
  }

  /** The current workspace's profile (M7-42): any member. */
  @Get('workspace')
  @Roles(WorkspaceRole.VIEWER)
  profile() {
    return this.workspaces.profile();
  }

  /** D-2 §2.7: name, website, industry, contact and time zone; owner only. */
  @Patch('workspace')
  @Roles(WorkspaceRole.OWNER)
  update(@Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.updateCurrent(dto);
  }

  /** Who belongs to this workspace (M7-42): owner and admin. */
  @Get('workspace/members')
  @Roles(WorkspaceRole.ADMIN)
  members() {
    return this.workspaces.members();
  }
}
