import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers';

function run(path: string) {
  const headers = new Map<string, string>();
  const next = jest.fn();
  securityHeaders(
    { path } as Request,
    {
      setHeader: (k: string, v: string) => headers.set(k, v),
    } as unknown as Response,
    next,
  );
  return { headers, next };
}

describe('securityHeaders', () => {
  it.each(['/v1/auth/me', '/health', '/v1/public/chatbots/cb_x/config', '/'])(
    'sets the baseline headers on %s',
    (path) => {
      const { headers, next } = run(path);
      expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headers.get('X-Frame-Options')).toBe('DENY');
      expect(headers.get('Content-Security-Policy')).toContain(
        "frame-ancestors 'none'",
      );
      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['/w/cb_abc', '/w/assets/index-1.js', '/chatbot.js'])(
    'leaves %s to set its own headers (it must be framable or embeddable)',
    (path) => {
      const { headers, next } = run(path);
      expect(headers.size).toBe(0);
      expect(next).toHaveBeenCalledTimes(1);
    },
  );
});
