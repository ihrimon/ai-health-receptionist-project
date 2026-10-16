import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Path prefix of the widget's public API (D-2 §3), after the `/v1` prefix. */
const PUBLIC_PREFIX = '/v1/public/';

/**
 * CORS per request (D-2 §4 layer 2). The dashboard may call everything,
 * with its session cookie. The widget app (`apps/widget`, its own origin)
 * may call only the public chat API, and without cookies: those routes
 * are `@Public()` and a widget never needs the dashboard session. Any
 * other origin gets no CORS headers, so its browser blocks the response.
 */
export function corsOptionsFor(
  origin: string | undefined,
  url: string,
  allowed: { dashboardUrl: string; widgetUrl: string },
): CorsOptions {
  if (origin === allowed.dashboardUrl) {
    return { origin: true, credentials: true };
  }
  if (origin === allowed.widgetUrl && url.startsWith(PUBLIC_PREFIX)) {
    return { origin: true, credentials: false };
  }
  return { origin: false };
}
