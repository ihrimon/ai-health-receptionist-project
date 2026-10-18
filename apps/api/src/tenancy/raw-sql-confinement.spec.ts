import * as fs from 'fs';
import * as path from 'path';

/**
 * Raw SQL bypasses the tenant Prisma extension, so it must stay in the few
 * files that add their own workspace condition (D-1 decision 7). A new
 * $queryRaw elsewhere fails this test and has to be reviewed and added
 * here on purpose.
 *
 * knowledge.service.ts adds workspace_id to every knowledge_chunks query;
 * the integration suite proves it (M2-12). analytics.service.ts adds it to
 * every table its day-grouping queries read (M5-8), proven the same way.
 * app-role.script.ts is a CLI that touches no tenant table: it only reads
 * pg_roles and runs ALTER ROLE for the app's database role (M7-1).
 */
const ALLOWED = new Set([
  'modules/knowledge/knowledge.service.ts',
  'modules/analytics/analytics.service.ts',
  'database/app-role.script.ts',
]);

// A call such as .$queryRaw`…` or .$executeRawUnsafe(…), not a mention in
// a comment.
const RAW_SQL = /\.\$(queryRaw|executeRaw)(Unsafe)?\s*[`(]/;

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

describe('raw SQL confinement', () => {
  it('only uses $queryRaw/$executeRaw in reviewed files', () => {
    const root = path.resolve(__dirname, '..');
    const offenders = sourceFiles(root)
      .filter((file) => RAW_SQL.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });
});
