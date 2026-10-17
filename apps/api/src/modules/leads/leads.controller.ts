import {
  type LeadExportQuery,
  leadExportQuerySchema,
  type LeadListQuery,
  leadListQuerySchema,
} from '@brainstack/shared';
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { LeadsService } from './leads.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** D-2 §2.6: captured leads (M5-5, FR-8.2). */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  list(@Query(new ZodBodyPipe(leadListQuerySchema)) query: LeadListQuery) {
    return this.leads.list(query);
  }

  /** Contact details leave the dashboard here, so owners and admins only. */
  @Get('export.csv')
  @Roles(WorkspaceRole.ADMIN)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async exportCsv(
    @Query(new ZodBodyPipe(leadExportQuerySchema)) query: LeadExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.leads.exportCsv(query);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="leads-${day}.csv"`,
    );
    return csv;
  }

  @Delete(':id')
  @Roles(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', uuid) id: string) {
    return this.leads.remove(id);
  }
}
