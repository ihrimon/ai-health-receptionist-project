import { Controller, Get } from '@nestjs/common';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { UsageService } from './usage.service';

/** D-2 §2.6: this month's chat use of the current workspace. */
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  current() {
    return this.usage.current();
  }
}
