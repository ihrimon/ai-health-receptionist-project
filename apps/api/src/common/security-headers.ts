import type { NextFunction, Request, Response } from 'express';

/**
 * Paths that set their own headers: the widget page needs to be framed
 * (it carries a `frame-ancestors` CSP), and the loader script is embedded
 * cross-origin by every company's site.
 */
const OWN_HEADERS = /^\/(?:w\/|chatbot\.js(?:$|\?))/;

/**
 * Baseline headers for the API's JSON, CSV and SSE responses (M7-2): the
 * browser must not sniff another content type or frame a response, and
 * nothing here is meant to be cached by shared caches (it can be tied to a
 * session).
 */
export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!OWN_HEADERS.test(req.path)) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
  }
  next();
}
