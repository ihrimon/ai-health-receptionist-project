import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EmailModule } from '../email/email.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetProcessor } from './password-reset.processor';
import { PasswordResetQueue } from './password-reset.queue';
import { SessionGuard } from './session.guard';
import { SessionsService } from './sessions.service';

@Module({
  imports: [EmailModule, WorkspacesModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PasswordResetQueue,
    PasswordResetProcessor,
    // Every route needs a session unless marked @Public().
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionsService],
})
export class AuthModule {}
