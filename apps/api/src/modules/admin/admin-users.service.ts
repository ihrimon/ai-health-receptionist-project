import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, WorkspaceRole } from '../../generated/prisma/client';
import { runAsSystem } from '../../tenancy/tenant-context';
import type { ListUsersQueryDto, UpdateUserDto } from './dto/admin.dto';

const DEFAULT_LIMIT = 25;

interface AdminActor {
  id: string;
  email: string;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  isPlatformAdmin: boolean;
  createdAt: Date;
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  emailVerifiedAt: true,
  isPlatformAdmin: true,
  createdAt: true,
  memberships: {
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      workspace: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.UserSelect;

type UserWithMemberships = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toRow(u: UserWithMemberships): AdminUserRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt,
    isPlatformAdmin: u.isPlatformAdmin,
    createdAt: u.createdAt,
    workspaces: u.memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
    })),
  };
}

/**
 * Platform-admin user operations (M7-35): list accounts, verify an email by
 * hand, grant or remove platform-admin access. Users are not tenant data, so
 * this uses PrismaService; every change is written to `audit_logs` in the
 * same transaction. Passwords, sessions and tokens are never returned.
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  private asPlatform<T>(fn: () => Promise<T>): Promise<T> {
    return runAsSystem('platform-admin console', fn);
  }

  list(query: ListUsersQueryDto) {
    return this.asPlatform(() => this.listInner(query));
  }

  private async listInner(query: ListUsersQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: Prisma.UserWhereInput = query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: userSelect,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toRow),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** Marks the email as verified (support case: the mail never arrived). */
  verifyEmail(actor: AdminActor, id: string): Promise<AdminUserRow> {
    return this.asPlatform(() => this.verifyEmailInner(actor, id));
  }

  private async verifyEmailInner(
    actor: AdminActor,
    id: string,
  ): Promise<AdminUserRow> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.emailVerifiedAt) {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id },
          data: { emailVerifiedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorEmail: actor.email,
            action: 'user.verify_email',
            details: { userId: user.id, userEmail: user.email },
          },
        }),
      ]);
    }
    return this.get(id);
  }

  /**
   * Grants or removes platform-admin access. An admin can't change their own
   * flag, so the platform can never be left without one by a misclick.
   */
  setPlatformAdmin(
    actor: AdminActor,
    id: string,
    dto: UpdateUserDto,
  ): Promise<AdminUserRow> {
    return this.asPlatform(() => this.setPlatformAdminInner(actor, id, dto));
  }

  private async setPlatformAdminInner(
    actor: AdminActor,
    id: string,
    dto: UpdateUserDto,
  ): Promise<AdminUserRow> {
    if (id === actor.id) {
      throw new BadRequestException(
        'You cannot change your own platform-admin access',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        isPlatformAdmin: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (dto.isPlatformAdmin && !user.emailVerifiedAt) {
      throw new BadRequestException(
        'Verify the email address before granting platform-admin access',
      );
    }
    if (user.isPlatformAdmin !== dto.isPlatformAdmin) {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id },
          data: { isPlatformAdmin: dto.isPlatformAdmin },
        }),
        this.prisma.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorEmail: actor.email,
            action: dto.isPlatformAdmin
              ? 'user.grant_admin'
              : 'user.revoke_admin',
            details: {
              userId: user.id,
              userEmail: user.email,
              reason: dto.reason || undefined,
            },
          },
        }),
      ]);
    }
    return this.get(id);
  }

  private async get(id: string): Promise<AdminUserRow> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: userSelect,
    });
    return toRow(user);
  }
}
