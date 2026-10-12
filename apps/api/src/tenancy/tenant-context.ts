import { AsyncLocalStorage } from 'async_hooks';
import { WorkspaceRole } from '../generated/prisma/client';

/** The workspace a dashboard request runs in (M1-22, NFR-1). */
export interface TenantContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Runs `fn` (and everything it awaits) inside `context`. */
export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The current tenant, or an error. Tenant-scoped data access calls this so
 * a query that somehow runs outside a workspace request fails instead of
 * silently reading every workspace.
 */
export function requireTenant(): TenantContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      'Tenant-scoped data accessed outside a workspace request. ' +
        'Add @Roles() to the route, or use PrismaService for platform data.',
    );
  }
  return context;
}
