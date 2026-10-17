import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SESSION_COOKIE } from './auth.constants';
import { AuthenticatedRequest } from './auth-context';
import {
  HiddenPlatformAdminGuard,
  PlatformAdminGuard,
} from './platform-admin.guard';
import { SessionGuard } from './session.guard';

function httpContext(req: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('SessionGuard', () => {
  const session = { id: 's1', user: { id: 'u1', isPlatformAdmin: false } };
  let reflector: { getAllAndOverride: jest.Mock };
  let sessions: { findValid: jest.Mock };
  let guard: SessionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    sessions = { findValid: jest.fn().mockResolvedValue(session) };
    guard = new SessionGuard(
      reflector as unknown as Reflector,
      sessions as never,
    );
  });

  it('lets @Public() routes through without looking up a session', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(httpContext({ cookies: {} }))).resolves.toBe(
      true,
    );
    expect(sessions.findValid).not.toHaveBeenCalled();
  });

  it('rejects a request with no cookie', async () => {
    await expect(
      guard.canActivate(httpContext({ cookies: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown or expired session', async () => {
    sessions.findValid.mockResolvedValue(null);
    await expect(
      guard.canActivate(httpContext({ cookies: { [SESSION_COOKIE]: 'tok' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the session and user to the request', async () => {
    const req: Partial<AuthenticatedRequest> = {
      cookies: { [SESSION_COOKIE]: 'tok' },
    };
    await expect(guard.canActivate(httpContext(req))).resolves.toBe(true);
    expect(sessions.findValid).toHaveBeenCalledWith('tok');
    expect(req.auth).toEqual({ session, user: session.user, token: 'tok' });
  });
});

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();
  const withUser = (isPlatformAdmin: boolean) =>
    httpContext({ auth: { user: { isPlatformAdmin } } as never });

  it('allows platform admins', () => {
    expect(guard.canActivate(withUser(true))).toBe(true);
  });

  it('rejects other users with 403', () => {
    expect(() => guard.canActivate(withUser(false))).toThrow(
      'Platform admin access required',
    );
  });
});

describe('HiddenPlatformAdminGuard (/v1/admin/*)', () => {
  const guard = new HiddenPlatformAdminGuard();
  const withUser = (isPlatformAdmin: boolean) =>
    httpContext({ auth: { user: { isPlatformAdmin } } as never });

  it('allows platform admins', () => {
    expect(guard.canActivate(withUser(true))).toBe(true);
  });

  it('answers 404, not 403, to everyone else', () => {
    expect(() => guard.canActivate(withUser(false))).toThrow(NotFoundException);
  });

  it('answers 404 when there is no session user at all', () => {
    expect(() => guard.canActivate(httpContext({}))).toThrow(NotFoundException);
  });
});
