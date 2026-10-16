import { Module } from '@nestjs/common';
import { WidgetFiles } from './widget-files';
import { WidgetPageCache } from './widget-page.cache';
import { WidgetPageController } from './widget-page.controller';
import { WidgetPageService } from './widget-page.service';

/**
 * The server-served widget page `/w/:publicId` with its `frame-ancestors`
 * CSP (M4-19). Exports the cache so `ChatbotService` can drop an entry
 * when a chatbot's domains, status or live version change.
 */
@Module({
  controllers: [WidgetPageController],
  providers: [WidgetPageService, WidgetPageCache, WidgetFiles],
  exports: [WidgetPageCache],
})
export class WidgetPageModule {}
