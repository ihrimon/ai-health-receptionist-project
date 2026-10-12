import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import { User } from '../../generated/prisma/client';
import { IS_PUBLIC_KEY } from './auth.constants';
import { SessionWithUser } from './sessions.service';

export interface AuthContext {
  session: SessionWithUser;
  user: User;
  /** The raw cookie token, for logout. */
  token: string;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/**
 * Opts a route (or a whole controller) out of the global SessionGuard.
 * Every other route requires a logged-in user.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** The logged-in user's session. Only on non-@Public() routes. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) {
      throw new Error('@CurrentAuth() used on a route without SessionGuard');
    }
    return auth;
  },
);
