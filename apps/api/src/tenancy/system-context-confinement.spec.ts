import * as fs from 'fs';
import * as path from 'path';

/**
 * M7-1: `runAsSystem` switches Postgres Row-Level Security off for the
 * queries inside it, so it may only appear in the reviewed places where a
 * query has to cross workspaces on purpose. A new call elsewhere fails this
 * test and has to be reviewed and added here deliberately.
 */
const ALLOWED = new Set([
  // Defines it.
  'tenancy/tenant-context.ts',
  // Finds the user's workspaces before one is active (login, /me, guards).
  'tenancy/workspace-access.service.ts',
  'modules/auth/auth.service.ts',
  // A workspace that doesn't exist yet (sign up, create workspace).
  'modules/workspaces/workspaces.service.ts',
  // Visitors have no session; a publicId finds the chatbot and workspace.
  'modules/public-chat/public-chat.service.ts',
  'modules/widget-page/widget-page.service.ts',
  // Platform-admin only: every workspace, and the platform audit trail.
  'modules/admin/admin.service.ts',
  'modules/admin/admin-users.service.ts',
  'modules/llm-credentials/llm-credentials.service.ts',
  // CLI: queues re-indexing for every workspace.
  'modules/knowledge/reembed.script.ts',
]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

describe('runAsSystem confinement', () => {
  const root = path.resolve(__dirname, '..');
  const users = sourceFiles(root)
    .filter((file) =>
      /\brunAsSystem\s*[(<]/.test(fs.readFileSync(file, 'utf8')),
    )
    .map((file) => path.relative(root, file).split(path.sep).join('/'));

  it('is only used in reviewed files', () => {
    expect(users.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });

  it('has no stale entries in the list', () => {
    expect([...ALLOWED].filter((file) => !users.includes(file))).toEqual([]);
  });

  it('is never used by controllers, guards or interceptors', () => {
    expect(
      users.filter((file) => /(controller|guard|interceptor)\.ts$/.test(file)),
    ).toEqual([]);
  });
});
