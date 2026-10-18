import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '../generated/prisma/client';
import { hasRole, WorkspaceAccessService } from './workspace-access.service';
import { TenantRequest, WorkspaceGuard } from './workspace.guard';

describe('hasRole', () => {
  it.each([
    [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, true],
    [WorkspaceRole.ADMIN, WorkspaceRole.ADMIN, true],
    [WorkspaceRole.VIEWER, WorkspaceRole.ADMIN, false],
    [WorkspaceRole.ADMIN, WorkspaceRole.OWNER, false],
    [WorkspaceRole.VIEWER, WorkspaceRole.VIEWER, true],
  ])('%s meets minimum %s: %s', (role, minimum, expected) => {
    expect(hasRole(role, minimum)).toBe(expected);
  });
});

describe('WorkspaceGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let access: { resolveActive: jest.Mock };
  let guard: WorkspaceGuard;
  let req: Partial<TenantRequest>;

  const ctx = () =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    access = {
      resolveActive: jest.fn().mockResolvedValue({
        workspaceId: 'ws-a',
        role: WorkspaceRole.ADMIN,
        workspaceStatus: 'ACTIVE',
      }),
    };
    guard = new WorkspaceGuard(
      reflector as unknown as Reflector,
      access as unknown as WorkspaceAccessService,
    );
    req = {
      auth: {
        session: { id: 's1', userId: 'u1', activeWorkspaceId: 'ws-a' },
        user: { id: 'u1' },
      } as never,
    };
  });

  it('sets the tenant from the active membership (default minimum: viewer)', async () => {
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(req.tenant).toEqual({
      workspaceId: 'ws-a',
      userId: 'u1',
      role: WorkspaceRole.ADMIN,
    });
  });

  it('403s with WORKSPACE_SUSPENDED for a suspended workspace, even for an owner', async () => {
    access.resolveActive.mockResolvedValue({
      workspaceId: 'ws-a',
      role: WorkspaceRole.OWNER,
      workspaceStatus: 'SUSPENDED',
    });
    const err: unknown = await guard
      .canActivate(ctx())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'WORKSPACE_SUSPENDED',
      message: expect.stringContaining('suspended') as string,
    });
    expect(req.tenant).toBeUndefined();
  });

  it('403s when the role is below the route minimum', async () => {
    reflector.getAllAndOverride.mockReturnValue(WorkspaceRole.OWNER);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(req.tenant).toBeUndefined();
  });

  it('403s for a user with no workspace at all', async () => {
    access.resolveActive.mockResolvedValue(null);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
