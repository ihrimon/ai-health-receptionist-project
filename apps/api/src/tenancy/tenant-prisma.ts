import { PrismaService } from '../database/prisma.service';
import { requireTenant } from './tenant-context';

/**
 * Models that carry a `workspaceId` column (D-1 §5). Every query on them
 * through the tenant client is limited to the current workspace. Grows as
 * M2+ adds tenant-owned models.
 */
export const TENANT_MODELS = new Set<string>([
  'WorkspaceMember',
  'Chatbot',
  'ChatbotVersion',
  'Faq',
  'CustomAnswer',
  'KnowledgeSource',
  'Product',
]);

const READ_MANY_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
const UNIQUE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown>;

function withTenantData(data: unknown, workspaceId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => withTenantData(row, workspaceId));
  }
  const row = (data ?? {}) as Args;
  if ('workspace' in row) {
    // A relation write could point the row at another workspace.
    throw new Error(
      'Set workspaceId through the tenant client, not a workspace relation',
    );
  }
  return { ...row, workspaceId };
}

const UPDATE_OPS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

/** Updates may not move a row to another workspace. */
function assertNoTenantChange(data: unknown): void {
  const row = (data ?? {}) as Args;
  if ('workspaceId' in row || 'workspace' in row) {
    throw new Error("A row's workspace can't be changed");
  }
}

/**
 * Rewrites one query so it can only see or write the current workspace.
 * Exported for unit tests; the extension below is the only caller.
 */
export function scopeArgs(
  model: string,
  operation: string,
  args: Args | undefined,
  workspaceId: string,
): Args {
  const a: Args = { ...(args ?? {}) };
  if (UPDATE_OPS.has(operation)) {
    assertNoTenantChange(operation === 'upsert' ? a.update : a.data);
  }

  // The Workspace row itself: only your own.
  if (model === 'Workspace') {
    if (CREATE_OPS.has(operation) || operation === 'upsert') {
      throw new Error('Workspaces are created by WorkspacesService');
    }
    // AND, not overwriting id: asking for another workspace finds nothing
    // instead of quietly returning your own.
    if (UNIQUE_OPS.has(operation)) {
      return {
        ...a,
        where: { ...(a.where as Args), AND: [{ id: workspaceId }] },
      };
    }
    if (READ_MANY_OPS.has(operation)) {
      return { ...a, where: { AND: [a.where ?? {}, { id: workspaceId }] } };
    }
    throw new Error(`Unsupported tenant operation: Workspace.${operation}`);
  }

  if (READ_MANY_OPS.has(operation)) {
    return { ...a, where: { AND: [a.where ?? {}, { workspaceId }] } };
  }
  // Unique lookups accept extra filters (Prisma 5+), so a record of another
  // workspace simply isn't found: the caller gets null or P2025 → 404.
  if (UNIQUE_OPS.has(operation)) {
    return { ...a, where: { ...(a.where as Args), workspaceId } };
  }
  if (CREATE_OPS.has(operation)) {
    return { ...a, data: withTenantData(a.data, workspaceId) };
  }
  if (operation === 'upsert') {
    return {
      ...a,
      where: { ...(a.where as Args), workspaceId },
      create: withTenantData(a.create, workspaceId),
    };
  }
  throw new Error(`Unsupported tenant operation: ${model}.${operation}`);
}

/**
 * Prisma client for tenant data (M1-24). Every query on a TENANT_MODELS
 * model gets `workspaceId = <current workspace>` added, and creates get it
 * set. Platform models (users, sessions, LLM credentials…) are refused:
 * use PrismaService for those.
 *
 * Not covered, by design: nested relation reads/writes inside a query (they
 * follow foreign keys from an already-scoped row) and raw SQL ($queryRaw),
 * which must add its own workspace condition (D-1 decision 7).
 */
export function createTenantPrisma(prisma: PrismaService) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model) && model !== 'Workspace') {
            throw new Error(
              `${model} is not tenant data; use PrismaService instead`,
            );
          }
          const { workspaceId } = requireTenant();
          return query(scopeArgs(model, operation, args, workspaceId));
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof createTenantPrisma>;

/** Injection token for the TenantPrisma client. */
export const TENANT_PRISMA = Symbol('TENANT_PRISMA');
