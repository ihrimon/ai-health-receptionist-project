import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie auth (D-2 §1): every state-changing request
 * must carry `X-Requested-With: fetch`. A plain HTML form on another site
 * can't set custom headers, and a cross-origin fetch that sets one needs a
 * CORS preflight, which only the dashboard's origin passes.
 */
export function requireFetchHeader(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    SAFE_METHODS.has(req.method) ||
    req.headers['x-requested-with'] === 'fetch'
  ) {
    next();
    return;
  }
  res.status(403).json({
    statusCode: 403,
    message: 'Missing X-Requested-With: fetch header',
    error: 'Forbidden',
  });
}
