import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, SESSION_COOKIE } from './auth.constants';
import { AuthenticatedRequest } from './auth-context';
import { SessionsService } from './sessions.service';

/**
 * Global guard (registered as APP_GUARD in AuthModule): every route needs
 * a valid session cookie unless it's marked @Public(). Deny-by-default, so
 * a new controller can't be exposed by forgetting a decorator.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const session = token ? await this.sessions.findValid(token) : null;
    if (!token || !session) {
      throw new UnauthorizedException('Login required');
    }

    req.auth = { session, user: session.user, token };
    return true;
  }
}
