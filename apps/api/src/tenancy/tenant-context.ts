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

/**
 * M7-1 (Row-Level Security): the few deliberate cross-tenant code paths
 * (login looking up a user's workspaces, the platform-admin module, a public
 * chat finding its workspace from a publicId, the re-embed script) run inside
 * `runAsSystem`. The database adapter then sets `app.rls_bypass` for those
 * queries, which the RLS policies allow. Everything else sees only the rows
 * of the current workspace, or none at all.
 */
const systemStorage = new AsyncLocalStorage<{ reason: string }>();

/**
 * Runs `fn` with the Postgres RLS bypass on. Keep it as small as possible,
 * ideally one lookup: the files allowed to call it are listed in
 * `system-context-confinement.spec.ts`. `reason` is for readers and logs.
 */
export async function runAsSystem<T>(
  reason: string,
  fn: () => Promise<T>,
): Promise<T> {
  return systemStorage.run({ reason }, async () => await fn());
}

/** Why the RLS bypass is on right now, or undefined when it is off. */
export function currentSystemReason(): string | undefined {
  return systemStorage.getStore()?.reason;
}
