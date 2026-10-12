import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceRole } from '../generated/prisma/client';

export interface ActiveMembership {
  workspaceId: string;
  role: WorkspaceRole;
}

/** Lowest to highest. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export function hasRole(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Which workspace a session works in, and with what role. */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The session's active workspace if the user is still a member of it.
   * Otherwise (none picked yet, the workspace was deleted, or the user was
   * removed) it falls back to their oldest membership and saves that on
   * the session. Null if they belong to no workspace at all.
   */
  async resolveActive(session: {
    id: string;
    userId: string;
    activeWorkspaceId: string | null;
  }): Promise<ActiveMembership | null> {
    if (session.activeWorkspaceId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: session.activeWorkspaceId,
            userId: session.userId,
          },
        },
      });
      if (member) return { workspaceId: member.workspaceId, role: member.role };
    }

    const fallback = await this.prisma.workspaceMember.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!fallback) return null;
    await this.prisma.session.update({
      where: { id: session.id },
      data: { activeWorkspaceId: fallback.workspaceId },
    });
    return { workspaceId: fallback.workspaceId, role: fallback.role };
  }

  /** The user's role in a workspace, or null if they aren't a member. */
  async roleIn(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceRole | null> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return member?.role ?? null;
  }
}
