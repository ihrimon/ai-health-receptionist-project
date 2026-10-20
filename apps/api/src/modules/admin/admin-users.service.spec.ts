import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';

const actor = { id: 'admin-1', email: 'root@brainstack.test' };

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Sam',
  email: 'sam@x.test',
  emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  isPlatformAdmin: false,
  createdAt: new Date('2026-09-30T00:00:00Z'),
  memberships: [{ role: 'OWNER', workspace: { id: 'w1', name: 'Acme' } }],
  ...over,
});

function setup() {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue(userRow()),
      update: jest.fn().mockReturnValue('update-op'),
    },
    auditLog: { create: jest.fn().mockReturnValue('audit-op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { prisma, service: new AdminUsersService(prisma as never) };
}

describe('AdminUsersService.list', () => {
  it('shapes rows, never selects secrets, and pages with a cursor', async () => {
    const { prisma, service } = setup();
    prisma.user.findMany.mockResolvedValue([
      userRow({ id: 'a' }),
      userRow({ id: 'b' }),
      userRow({ id: 'c' }),
    ]);

    const res = await service.list({ limit: 2 });

    expect(res.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBe('b');
    expect(res.items[0].workspaces).toEqual([
      { id: 'w1', name: 'Acme', role: 'OWNER' },
    ]);
    const args = (prisma.user.findMany.mock.calls as unknown[][])[0][0] as {
      select: Record<string, unknown>;
    };
    expect(args.select).not.toHaveProperty('passwordHash');
  });
});

describe('AdminUsersService.verifyEmail', () => {
  it('404s for a missing user', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.verifyEmail(actor, 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('verifies an unverified email and audits it', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@x.test',
      emailVerifiedAt: null,
    });
    await service.verifyEmail(actor, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledWith(['update-op', 'audit-op']);
    expect(
      (prisma.auditLog.create.mock.calls as unknown[][])[0][0],
    ).toMatchObject({ data: { action: 'user.verify_email' } });
  });

  it('does nothing and logs nothing when already verified', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@x.test',
      emailVerifiedAt: new Date(),
    });
    await service.verifyEmail(actor, 'u1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('AdminUsersService.setPlatformAdmin', () => {
  it("refuses to change the admin's own access", async () => {
    const { prisma, service } = setup();
    await expect(
      service.setPlatformAdmin(actor, actor.id, { isPlatformAdmin: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses to grant access to an unverified account', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@x.test',
      emailVerifiedAt: null,
      isPlatformAdmin: false,
    });
    await expect(
      service.setPlatformAdmin(actor, 'u1', { isPlatformAdmin: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('grants and revokes with an audit row each, and skips a no-op', async () => {
    const { prisma, service } = setup();
    const base = {
      id: 'u1',
      email: 'sam@x.test',
      emailVerifiedAt: new Date(),
    };
    prisma.user.findUnique.mockResolvedValueOnce({
      ...base,
      isPlatformAdmin: false,
    });
    await service.setPlatformAdmin(actor, 'u1', {
      isPlatformAdmin: true,
      reason: 'New teammate',
    });
    prisma.user.findUnique.mockResolvedValueOnce({
      ...base,
      isPlatformAdmin: true,
    });
    await service.setPlatformAdmin(actor, 'u1', { isPlatformAdmin: false });
    prisma.user.findUnique.mockResolvedValueOnce({
      ...base,
      isPlatformAdmin: true,
    });
    await service.setPlatformAdmin(actor, 'u1', { isPlatformAdmin: true });

    const actions = (prisma.auditLog.create.mock.calls as unknown[][]).map(
      (c) => (c[0] as { data: { action: string } }).data.action,
    );
    expect(actions).toEqual(['user.grant_admin', 'user.revoke_admin']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
