import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from './tenant-context';
import { TenantRequest } from './workspace.guard';

/**
 * Global interceptor: if WorkspaceGuard set `req.tenant`, the handler runs
 * inside that tenant context. Subscribing inside runWithTenant (not just
 * calling next.handle() there) matters: the handler only executes on
 * subscribe.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const tenant = context.switchToHttp().getRequest<TenantRequest>().tenant;
    if (!tenant) return next.handle();

    return new Observable((subscriber) =>
      runWithTenant(tenant, () => next.handle().subscribe(subscriber)),
    );
  }
}
