import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth } from '../auth/auth-context';
import { RenameWorkspaceDto, SwitchWorkspaceDto } from './dto/workspace.dto';
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

  /** D-2 §2.7 */
  @Patch('workspace')
  @Roles(WorkspaceRole.OWNER)
  rename(@Body() dto: RenameWorkspaceDto) {
    return this.workspaces.renameCurrent(dto.name);
  }
}
