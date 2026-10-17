import {
  type AnalyticsOverviewQuery,
  analyticsOverviewQuerySchema,
} from '@brainstack/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { AnalyticsService } from './analytics.service';

/** D-2 §2.6: the dashboard's analytics (M5-8 overview). */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Roles(WorkspaceRole.VIEWER)
  overview(
    @Query(new ZodBodyPipe(analyticsOverviewQuerySchema))
    query: AnalyticsOverviewQuery,
  ) {
    return this.analytics.overview(query);
  }
}
