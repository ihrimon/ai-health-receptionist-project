import { firstValueFrom, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { WorkspaceRole } from '../generated/prisma/client';
import { currentTenant, requireTenant, runWithTenant } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';

const ctxA = { workspaceId: 'ws-a', userId: 'u1', role: WorkspaceRole.OWNER };
const ctxB = { workspaceId: 'ws-b', userId: 'u2', role: WorkspaceRole.VIEWER };

describe('tenant context', () => {
  it('is empty outside a request, and requireTenant fails closed', () => {
    expect(currentTenant()).toBeUndefined();
    expect(() => requireTenant()).toThrow('outside a workspace request');
  });

  it('survives awaits inside runWithTenant', async () => {
    const seen = await runWithTenant(ctxA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return requireTenant().workspaceId;
    });
    expect(seen).toBe('ws-a');
  });

  it('keeps concurrent requests apart', async () => {
    const read = (ctx: typeof ctxA, ms: number) =>
      runWithTenant(ctx, async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return requireTenant().workspaceId;
      });
    await expect(Promise.all([read(ctxA, 20), read(ctxB, 5)])).resolves.toEqual(
      ['ws-a', 'ws-b'],
    );
  });
});

describe('TenantContextInterceptor', () => {
  const interceptor = new TenantContextInterceptor();
  const httpContext = (tenant?: typeof ctxA) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
    }) as never;
  // Like a real handler: the work (and the context read) happens later,
  // after an async hop.
  const handler = {
    handle: () =>
      of(null).pipe(
        delay(5),
        map(() => currentTenant()?.workspaceId),
      ),
  };

  it("runs the handler inside the request's tenant context", async () => {
    await expect(
      firstValueFrom(interceptor.intercept(httpContext(ctxA), handler)),
    ).resolves.toBe('ws-a');
  });

  it('leaves non-workspace routes without a tenant', async () => {
    await expect(
      firstValueFrom(interceptor.intercept(httpContext(undefined), handler)),
    ).resolves.toBeUndefined();
  });
});
