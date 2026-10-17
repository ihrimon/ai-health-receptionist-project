import {
  type AnalyticsOverviewQuery,
  type AnalyticsTopQuestionsQuery,
  type AnalyticsUnansweredQuery,
  analyticsUnansweredQuerySchema,
  analyticsTopQuestionsQuerySchema,
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

  @Get('top-questions')
  @Roles(WorkspaceRole.VIEWER)
  topQuestions(
    @Query(new ZodBodyPipe(analyticsTopQuestionsQuerySchema))
    query: AnalyticsTopQuestionsQuery,
  ) {
    return this.analytics.topQuestions(query);
  }

  @Get('unanswered')
  @Roles(WorkspaceRole.VIEWER)
  unanswered(
    @Query(new ZodBodyPipe(analyticsUnansweredQuerySchema))
    query: AnalyticsUnansweredQuery,
  ) {
    return this.analytics.unanswered(query);
  }
}
