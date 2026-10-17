import { readFileSync } from 'fs';
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
