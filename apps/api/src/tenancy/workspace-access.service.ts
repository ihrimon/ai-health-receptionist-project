import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceRole, WorkspaceStatus } from '../generated/prisma/client';
import { runAsSystem } from './tenant-context';

export interface ActiveMembership {
  workspaceId: string;
  role: WorkspaceRole;
  /** Suspended workspaces are blocked by WorkspaceGuard (M7-0). */
  workspaceStatus: WorkspaceStatus;
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
  resolveActive(session: {
    id: string;
    userId: string;
    activeWorkspaceId: string | null;
  }): Promise<ActiveMembership | null> {
    // Runs before any workspace is chosen, so it can't be scoped to one (M7-1).
    return runAsSystem('resolve active workspace', () =>
      this.resolveActiveInner(session),
    );
  }

  private async resolveActiveInner(session: {
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
        include: { workspace: { select: { status: true } } },
      });
      if (member) {
        return {
          workspaceId: member.workspaceId,
          role: member.role,
          workspaceStatus: member.workspace.status,
        };
      }
    }

    const fallback = await this.prisma.workspaceMember.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: 'asc' },
      include: { workspace: { select: { status: true } } },
    });
    if (!fallback) return null;
    await this.prisma.session.update({
      where: { id: session.id },
      data: { activeWorkspaceId: fallback.workspaceId },
    });
    return {
      workspaceId: fallback.workspaceId,
      role: fallback.role,
      workspaceStatus: fallback.workspace.status,
    };
  }

  /** The user's role in a workspace, or null if they aren't a member. */
  async roleIn(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceRole | null> {
    const member = await runAsSystem('role in workspace', () =>
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      }),
    );
    return member?.role ?? null;
  }
}
