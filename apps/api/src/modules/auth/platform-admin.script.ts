import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../../config/configuration';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
  ],
})
class PlatformAdminCliModule {}

/**
 * Grants (or with --revoke, removes) platform admin access, which the LLM
 * credentials and interim conversations endpoints require. There's no UI
 * for this on purpose; the super-admin console comes in M7-0.
 *
 * Usage: pnpm --filter api user:platform-admin <email> [--revoke]
 */
async function main() {
  const args = process.argv.slice(2);
  const email = args
    .find((a) => !a.startsWith('--'))
    ?.trim()
    .toLowerCase();
  const revoke = args.includes('--revoke');
  if (!email) {
    console.error(
      'Usage: pnpm --filter api user:platform-admin <email> [--revoke]',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(
    PlatformAdminCliModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const { count } = await app.get(PrismaService).user.updateMany({
      where: { email },
      data: { isPlatformAdmin: !revoke },
    });
    if (count === 0) {
      console.error(`No user with email ${email}. Register first.`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `${email} is ${revoke ? 'no longer' : 'now'} a platform admin.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
