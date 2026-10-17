import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { LeadNotifyProcessor } from './lead-notify.processor';
import { LeadNotifyQueue } from './lead-notify.queue';
import { LeadNotifyService } from './lead-notify.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * Captured leads (M5-5): the dashboard list, CSV export, create() for
 * capture_lead (M5-4), and the new-lead email to the owners (M5-6).
 */
@Module({
  imports: [EmailModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadNotifyQueue,
    LeadNotifyService,
    LeadNotifyProcessor,
  ],
  exports: [LeadsService],
})
export class LeadsModule {}
