import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';

/** Where the widget page's built JS and CSS are served (`/w/assets/<file>`). */
export const WIDGET_ASSETS_PATH = '/w/assets/';

/**
 * The static build of `apps/widget` (`dist/`: `index.html`, `assets/`,
 * `chatbot.js`), which the API serves next to the widget page (M4-19).
 * The build uses relative asset paths (`./assets/…`); the page lives at
 * `/w/<publicId>`, so they are made absolute here, which also keeps them
 * right for `/w/<publicId>/` with a trailing slash.
 */
@Injectable()
export class WidgetFiles {
  private readonly logger = new Logger(WidgetFiles.name);
  readonly distDir: string;
  private readonly keepInMemory: boolean;
  private html: string | null = null;

  constructor(config: ConfigService) {
    this.distDir = config.get<string>('widget.distDir') ?? '';
    // Locally the widget may be rebuilt while the API runs.
    this.keepInMemory = config.get<string>('nodeEnv') === 'production';
  }

  get assetsDir(): string {
    return join(this.distDir, 'assets');
  }

  get loaderFile(): string {
    return join(this.distDir, 'chatbot.js');
  }

  /** The page's HTML, the same for every chatbot; null when not built. */
  async page(): Promise<string | null> {
    if (this.html !== null) return this.html;
    let built: string;
    try {
      built = await readFile(join(this.distDir, 'index.html'), 'utf8');
    } catch {
      this.logger.warn(
        `No widget build in ${this.distDir}; run \`pnpm --filter widget build\``,
      );
      return null;
    }
    const html = built.split('"./assets/').join(`"${WIDGET_ASSETS_PATH}`);
    if (this.keepInMemory) this.html = html;
    return html;
  }
}
