import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
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

/**
 * Guard for the `/v1/admin/*` namespace (M7-0): a non-admin gets the same
 * 404 as for a route that doesn't exist, so the area can't be discovered.
 * The flag is read from the user row the SessionGuard just loaded, and no
 * API path can set it (only `pnpm --filter api user:platform-admin`).
 */
@Injectable()
export class HiddenPlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth?.user.isPlatformAdmin) {
      throw new NotFoundException();
    }
    return true;
  }
}

export const HiddenPlatformAdminOnly = () =>
  UseGuards(HiddenPlatformAdminGuard);
