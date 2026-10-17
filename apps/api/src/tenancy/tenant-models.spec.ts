import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { TENANT_MODELS } from './tenant-prisma';

/** Models with a workspace_id that are platform data on purpose (admin-only). */
const PLATFORM_MODELS_WITH_WORKSPACE_ID = new Set(['AuditLog']);

/**
 * M7-2: a new tenant-owned table that is left out of TENANT_MODELS would be
 * unscoped when read through the tenant client's sibling, PrismaService. This
 * reads the schema, so forgetting the list fails the build.
 */
describe('TENANT_MODELS', () => {
  const schema = readFileSync(
    join(__dirname, '../../prisma/schema.prisma'),
    'utf8',
  );
  const modelsWithWorkspaceId: string[] = [];
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (/^\s+workspaceId\s/m.test(match[2]))
      modelsWithWorkspaceId.push(match[1]);
  }

  it('finds the models in the schema', () => {
    expect(modelsWithWorkspaceId.length).toBeGreaterThan(10);
  });

  it('lists every model that carries a workspaceId', () => {
    const missing = modelsWithWorkspaceId.filter(
      (model) =>
        !TENANT_MODELS.has(model) &&
        !PLATFORM_MODELS_WITH_WORKSPACE_ID.has(model),
    );
    expect(missing).toEqual([]);
  });

  it('lists only models that exist and carry a workspaceId', () => {
    const extra = [...TENANT_MODELS].filter(
      (model) => !modelsWithWorkspaceId.includes(model),
    );
    expect(extra).toEqual([]);
  });
});

/**
 * M7-1: the database enforces the same rule a second time with Row-Level
 * Security. A table with a workspace_id (or the workspaces table itself)
 * that no migration puts a policy on would be protected by the app's own
 * scoping only, so this fails the build. The integration suite
 * (rls.int-spec.ts) proves the policies work against a real database.
 */
describe('Row-Level Security policies', () => {
  const schema = readFileSync(
    join(__dirname, '../../prisma/schema.prisma'),
    'utf8',
  );
  const tableOf = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const mapped = /@@map\("(\w+)"\)/.exec(match[2]);
    if (mapped) tableOf.set(match[1], mapped[1]);
  }

  const migrationsDir = join(__dirname, '../../prisma/migrations');
  const migrationSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8'),
    )
    // Only migrations that deal with row security at all.
    .filter((sql) => sql.includes('ROW LEVEL SECURITY'));

  /** Is there a migration that enables, forces and writes a policy for `table`? */
  const hasPolicy = (table: string) =>
    migrationSql.some(
      (sql) =>
        sql.includes('ENABLE ROW LEVEL SECURITY') &&
        sql.includes('FORCE ROW LEVEL SECURITY') &&
        sql.includes('CREATE POLICY') &&
        (sql.includes(`'${table}'`) || sql.includes(`"${table}"`)),
    );

  const models = [...TENANT_MODELS, 'Workspace', 'AuditLog'];

  it('knows the table of every model it checks', () => {
    expect(models.filter((model) => !tableOf.has(model))).toEqual([]);
  });

  it('has an ENABLE + FORCE ROW LEVEL SECURITY policy for every tenant table', () => {
    const missing = models
      .map((model) => tableOf.get(model) as string)
      .filter((table) => !hasPolicy(table));
    expect(missing).toEqual([]);
  });
});
