import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest } from './auth-context';

/**
 * Platform-level routes — LLM credentials and the interim, not yet
 * workspace-scoped conversations — need `users.is_platform_admin` (M1
 * decision). Runs after the global SessionGuard, which sets `req.auth`.
 * Grant it with `pnpm --filter api user:platform-admin <email>`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth?.user.isPlatformAdmin) {
      throw new ForbiddenException('Platform admin access required');
    }
    return true;
  }
}

export const PlatformAdminOnly = () => UseGuards(PlatformAdminGuard);
