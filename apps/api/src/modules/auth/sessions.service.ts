import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { SESSION_TTL_MS } from './auth.constants';
import { generateToken, hashToken } from './secrets';

export interface NewSession {
  userId: string;
  activeWorkspaceId: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  /** Raw token for the cookie; never stored. */
  token: string;
  expiresAt: Date;
}

export type SessionWithUser = Prisma.SessionGetPayload<{
  include: { user: true };
}>;

/** Dashboard login sessions, stored in Postgres (M1-17, T5). */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: NewSession,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: input.userId,
        activeWorkspaceId: input.activeWorkspaceId,
        expiresAt,
        ipAddress: input.ipAddress?.slice(0, 45),
        userAgent: input.userAgent?.slice(0, 500),
      },
    });
    return { token, expiresAt };
  }

  /** The session behind a cookie token, or null if unknown or expired. */
  async findValid(token: string): Promise<SessionWithUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return session;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  async revokeAllForUser(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await db.session.deleteMany({ where: { userId } });
  }
}
