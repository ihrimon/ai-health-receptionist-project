import type { Request, Response } from 'express';
import { requireFetchHeader } from './require-fetch-header';

describe('requireFetchHeader', () => {
  function run(method: string, headers: Record<string, string> = {}) {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireFetchHeader(
      { method, headers } as unknown as Request,
      res as unknown as Response,
      next,
    );
    return { next, res };
  }

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets %s through without the header',
    (method) => {
      expect(run(method).next).toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'blocks %s without the header',
    (method) => {
      const { next, res } = run(method);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    },
  );

  it('lets a state-changing request through with X-Requested-With: fetch', () => {
    expect(
      run('POST', { 'x-requested-with': 'fetch' }).next,
    ).toHaveBeenCalled();
  });

  it('rejects any other X-Requested-With value', () => {
    expect(
      run('POST', { 'x-requested-with': 'XMLHttpRequest' }).next,
    ).not.toHaveBeenCalled();
  });
});
