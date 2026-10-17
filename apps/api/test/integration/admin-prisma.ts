import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

/**
 * A Prisma client on the owner/admin connection (DATABASE_ADMIN_URL).
 * Tests use it to arrange and inspect data across workspaces: it is not
 * subject to Row-Level Security (M7-1), unlike the app's own PrismaService,
 * which connects as the restricted `brainstack_app` role.
 */
export function createAdminPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
