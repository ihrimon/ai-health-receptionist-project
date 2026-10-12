import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '../generated/prisma/client';
import { AuthenticatedRequest } from '../modules/auth/auth-context';
import { TenantContext } from './tenant-context';
import { hasRole, WorkspaceAccessService } from './workspace-access.service';

const MIN_ROLE_KEY = 'tenancy:minRole';

export type TenantRequest = AuthenticatedRequest & { tenant?: TenantContext };

/**
 * M1-23: resolves the session's active workspace and checks the user's
 * role there. Runs after the global SessionGuard. On success it sets
 * `req.tenant`, which TenantContextInterceptor turns into the tenant
 * context for the handler (and the tenant Prisma client).
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: WorkspaceAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    if (!req.auth) {
      throw new Error('WorkspaceGuard needs SessionGuard to run first');
    }

    const active = await this.access.resolveActive(req.auth.session);
    if (!active) {
      throw new ForbiddenException('You are not a member of any workspace');
    }

    const minimum =
      this.reflector.getAllAndOverride<WorkspaceRole>(MIN_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? WorkspaceRole.VIEWER;
    if (!hasRole(active.role, minimum)) {
      throw new ForbiddenException(
        `This needs the ${minimum.toLowerCase()} role or higher`,
      );
    }

    req.tenant = {
      workspaceId: active.workspaceId,
      userId: req.auth.user.id,
      role: active.role,
    };
    return true;
  }
}

/**
 * Marks a route (or controller) as workspace data and sets the minimum
 * role (D-2 lists one per endpoint): `@Roles('VIEWER')` lets everyone in,
 * `@Roles('OWNER')` only owners.
 */
export const Roles = (minimum: WorkspaceRole) =>
  applyDecorators(
    SetMetadata(MIN_ROLE_KEY, minimum),
    UseGuards(WorkspaceGuard),
  );
