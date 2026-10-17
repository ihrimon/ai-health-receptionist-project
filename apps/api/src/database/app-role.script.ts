import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';

config({ path: ['../../.env', '.env'], quiet: true });

/**
 * Lets the restricted `brainstack_app` role log in (M7-1). The migration
 * creates the role without a login because it can't know a password; run
 * this once per database server, as the owner:
 *
 *   APP_DB_PASSWORD=<secret> pnpm --filter api db:app-role
 *
 * Without APP_DB_PASSWORD it sets the development password `brainstack_app`
 * and refuses to do so when NODE_ENV is production. Production is done by
 * hand with psql (docs/design/m7-1-rls-plan.md).
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_ADMIN_URL or DATABASE_URL');
  const password = process.env.APP_DB_PASSWORD;
  if (!password && process.env.NODE_ENV === 'production') {
    throw new Error('Set APP_DB_PASSWORD; no default password in production');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const roles = await prisma.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'brainstack_app'`;
    if (roles.length === 0) {
      throw new Error(
        'Role brainstack_app does not exist yet: run the migrations first (pnpm --filter api prisma:deploy).',
      );
    }
    if (roles[0].rolsuper || roles[0].rolbypassrls) {
      throw new Error(
        'brainstack_app is a superuser or has BYPASSRLS; row-level security would not apply to it.',
      );
    }
    // The password can't be a bind parameter in DDL; the server quotes it.
    const [{ statement }] = await prisma.$queryRaw<{ statement: string }[]>`
      SELECT format('ALTER ROLE brainstack_app LOGIN PASSWORD %L', ${password ?? 'brainstack_app'}::text) AS statement`;
    await prisma.$executeRawUnsafe(statement);
    console.log('brainstack_app can now log in.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
