import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth-context';
import { WidgetFiles } from './widget-files';
import {
  NOT_FOUND_HEADERS,
  NOT_FOUND_PAGE,
  widgetPageHeaders,
} from './widget-page-headers';
import { WidgetPageService } from './widget-page.service';

/** A built asset's file name (hashed by Vite): no slashes, no leading dot. */
const ASSET_FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/**
 * The widget's chat page and its static files (M4-19), outside the `/v1`
 * prefix (app.setup.ts): the loader opens `<origin>/w/<publicId>` in an
 * iframe, so these paths are part of every embed snippet.
 *
 * - `GET /w/:publicId`: the page, with `frame-ancestors` from that
 *   chatbot's allowed domains; 404 page for an unknown, unpublished or
 *   switched-off chatbot. The first load framed by an allowed site
 *   (`Referer`, else the loader's `?host=`) is recorded as the install
 *   (M4-14).
 * - `GET /w/assets/:file`: the page's hashed JS and CSS, cached for a year.
 * - `GET /chatbot.js`: the embed loader; built without `VITE_WIDGET_URL`,
 *   it opens the page on the origin it was loaded from, this one.
 */
@Controller()
@Public()
export class WidgetPageController {
  constructor(
    private readonly pages: WidgetPageService,
    private readonly files: WidgetFiles,
  ) {}

  @Get('w/:publicId')
  async page(
    @Param('publicId') publicId: string,
    @Query('host') hostParam: unknown,
    @Headers('referer') referer: string | undefined,
    @Headers('sec-fetch-dest') fetchDest: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const page = await this.pages.pageFor(publicId);
    if (page === null) {
      res.status(404).set(NOT_FOUND_HEADERS).send(NOT_FOUND_PAGE);
      return;
    }
    // "Verify installation" (M4-14): the first load inside an allowed site.
    await this.pages.recordInstall(publicId, page, {
      referer,
      hostParam,
      fetchDest,
    });
    const html = await this.files.page();
    if (html === null) {
      res
        .status(503)
        .set({ ...NOT_FOUND_HEADERS, 'Retry-After': '60' })
        .send(NOT_FOUND_PAGE);
      return;
    }
    res.status(200).set(widgetPageHeaders(page.ancestors)).send(html);
  }

  @Get('w/assets/:file')
  asset(@Param('file') file: string, @Res() res: Response): void {
    if (!ASSET_FILE.test(file)) {
      res.status(404).end();
      return;
    }
    res.sendFile(
      file,
      {
        root: this.files.assetsDir,
        maxAge: '365d',
        immutable: true,
        dotfiles: 'deny',
        headers: { 'X-Content-Type-Options': 'nosniff' },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      },
    );
  }

  @Get('chatbot.js')
  loader(@Res() res: Response): void {
    res.sendFile(
      this.files.loaderFile,
      {
        // The snippet URL never changes, so a new build reaches sites
        // within minutes.
        maxAge: '5m',
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          // Every company's site loads it, including ones with COEP.
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      },
    );
  }
}
