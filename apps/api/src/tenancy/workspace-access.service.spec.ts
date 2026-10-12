import { WorkspaceRole } from '../generated/prisma/client';
import { WorkspaceAccessService } from './workspace-access.service';

describe('WorkspaceAccessService.resolveActive', () => {
  let prisma: {
    workspaceMember: { findUnique: jest.Mock; findFirst: jest.Mock };
    session: { update: jest.Mock };
  };
  let service: WorkspaceAccessService;

  beforeEach(() => {
    prisma = {
      workspaceMember: { findUnique: jest.fn(), findFirst: jest.fn() },
      session: { update: jest.fn() },
    };
    service = new WorkspaceAccessService(prisma as never);
  });

  const session = { id: 's1', userId: 'u1', activeWorkspaceId: 'ws-a' };

  it("uses the session's workspace while the user is still a member", async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: 'ws-a',
      role: WorkspaceRole.ADMIN,
    });

    await expect(service.resolveActive(session)).resolves.toEqual({
      workspaceId: 'ws-a',
      role: WorkspaceRole.ADMIN,
    });
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('falls back to the oldest membership and saves it on the session', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    prisma.workspaceMember.findFirst.mockResolvedValue({
      workspaceId: 'ws-c',
      role: WorkspaceRole.VIEWER,
    });

    await expect(service.resolveActive(session)).resolves.toEqual({
      workspaceId: 'ws-c',
      role: WorkspaceRole.VIEWER,
    });
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { activeWorkspaceId: 'ws-c' },
    });
  });

  it('returns null for a user with no memberships', async () => {
    prisma.workspaceMember.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveActive({ ...session, activeWorkspaceId: null }),
    ).resolves.toBeNull();
  });
});
