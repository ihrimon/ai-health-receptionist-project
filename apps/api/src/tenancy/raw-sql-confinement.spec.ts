import * as fs from 'fs';
import * as path from 'path';

/**
 * Raw SQL bypasses the tenant Prisma extension, so it must stay in the few
 * files that add their own workspace condition (D-1 decision 7). A new
 * $queryRaw elsewhere fails this test and has to be reviewed and added
 * here on purpose.
 *
 * knowledge_chunks has no workspace column yet; its isolation test comes
 * with M2-12, when it gets one.
 */
const ALLOWED = new Set(['modules/knowledge/knowledge.service.ts']);

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
