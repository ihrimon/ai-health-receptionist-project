import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Same lookup order as the Nest app (app.module.ts): the shared root .env
// first, then an optional apps/api/.env. Prisma's CLI doesn't load .env
// files on its own.
config({ path: ['../../.env', '.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations need the owner role (M7-1); DATABASE_URL is the restricted
    // app role once production switches to it.
    url: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL,
  },
});
