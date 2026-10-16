import type { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WidgetFiles } from './widget-files';

const configFor = (distDir: string, nodeEnv = 'development') =>
  ({
    get: (key: string) => (key === 'widget.distDir' ? distDir : nodeEnv),
  }) as unknown as ConfigService;

describe('WidgetFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'widget-dist-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("makes the build's relative asset paths absolute under /w/assets/", async () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<script type="module" src="./assets/index-1.js"></script><link href="./assets/index-2.css">',
    );

    await expect(new WidgetFiles(configFor(dir)).page()).resolves.toBe(
      '<script type="module" src="/w/assets/index-1.js"></script><link href="/w/assets/index-2.css">',
    );
  });

  it('is null when the widget is not built', async () => {
    await expect(
      new WidgetFiles(configFor(join(dir, 'missing'))).page(),
    ).resolves.toBeNull();
  });

  it('re-reads a rebuilt page outside production, keeps it in production', async () => {
    const page = join(dir, 'index.html');
    writeFileSync(page, 'v1');
    const dev = new WidgetFiles(configFor(dir));
    const prod = new WidgetFiles(configFor(dir, 'production'));
    await dev.page();
    await prod.page();

    writeFileSync(page, 'v2');
    await expect(dev.page()).resolves.toBe('v2');
    await expect(prod.page()).resolves.toBe('v1');
  });
});
