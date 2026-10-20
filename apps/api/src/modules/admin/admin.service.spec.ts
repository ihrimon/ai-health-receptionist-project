import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AdminService } from './admin.service';

const actor = { id: 'admin-1', email: 'root@brainstack.test' };

function setup() {
  const prisma = {
    workspace: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockReturnValue('update-op'),
    },
    auditLog: {
      createMany: jest.fn().mockReturnValue('audit-op'),
      create: jest.fn().mockReturnValue('audit-op'),
      findMany: jest.fn().mockResolvedValue([]),
    },
    chatbot: { findMany: jest.fn().mockResolvedValue([{ publicId: 'cb_1' }]) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const cache = { invalidate: jest.fn() };
  const storage = { deleteForWorkspace: jest.fn().mockResolvedValue(0) };
  const service = new AdminService(
    prisma as never,
    cache as never,
    { get: () => undefined } as never,
    storage as never,
  );
  service.now = () => new Date('2026-10-17T10:00:00Z');
  return { prisma, cache, storage, service };
}

const row = (id: string) => ({
  id,
  name: `Shop ${id}`,
  slug: `shop-${id}`,
  status: 'ACTIVE',
  plan: 'BETA',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  members: [{ user: { id: 'u', name: 'Owner', email: 'o@x.test' } }],
  usageCounters: [{ messages: 12 }],
  _count: { chatbots: 1 },
});

describe('AdminService.listWorkspaces', () => {
  it('shapes rows and gives the next cursor only when more rows exist', async () => {
    const { prisma, service } = setup();
    prisma.workspace.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);

    const res = await service.listWorkspaces({ limit: 2 });

    expect(res.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBe('b');
    expect(res.items[0]).toMatchObject({
      owner: { email: 'o@x.test' },
      chatbotCount: 1,
      messagesThisMonth: 12,
    });
    const args = (
      prisma.workspace.findMany.mock.calls as unknown[][]
    )[0][0] as {
      take: number;
      select: { usageCounters: { where: { period: string } } };
    };
    expect(args.take).toBe(3);
    expect(args.select.usageCounters.where.period).toBe('2026-10');
  });

  it('searches the name and the owner email, filters by status, and follows the cursor', async () => {
    const { prisma, service } = setup();
    await service.listWorkspaces({
      q: 'Acme',
      status: 'SUSPENDED',
      cursor: 'x',
    });
    const args = (
      prisma.workspace.findMany.mock.calls as unknown[][]
    )[0][0] as {
      where: { status: string; OR: unknown[] };
      cursor: { id: string };
      skip: number;
    };
    expect(args.where.status).toBe('SUSPENDED');
    expect(args.where.OR).toHaveLength(2);
    expect(JSON.stringify(args.where.OR)).toContain('"role":"OWNER"');
    expect(args.cursor).toEqual({ id: 'x' });
    expect(args.skip).toBe(1);
  });

  it('has no owner and zero messages for a workspace without either', async () => {
    const { prisma, service } = setup();
    prisma.workspace.findMany.mockResolvedValue([
      { ...row('a'), members: [], usageCounters: [] },
    ]);
    const res = await service.listWorkspaces({});
    expect(res.items[0]).toMatchObject({ owner: null, messagesThisMonth: 0 });
    expect(res.nextCursor).toBeNull();
  });
});

describe('AdminService.updateWorkspace', () => {
  const current = { id: 'w1', name: 'Acme', status: 'ACTIVE', plan: 'BETA' };

  it('needs a status or a plan', async () => {
    const { service } = setup();
    await expect(
      service.updateWorkspace(actor, 'w1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for an unknown workspace', async () => {
    const { prisma, service } = setup();
    prisma.workspace.findUnique.mockResolvedValue(null);
    await expect(
      service.updateWorkspace(actor, 'w1', { plan: 'GROWTH' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('suspends, writes the audit row in the same transaction and drops the widget cache', async () => {
    const { prisma, cache, service } = setup();
    prisma.workspace.findUnique.mockResolvedValue(current);
    prisma.workspace.findUniqueOrThrow.mockResolvedValue(row('w1'));

    await service.updateWorkspace(actor, 'w1', {
      status: 'SUSPENDED',
      reason: 'abuse',
    });

    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { status: 'SUSPENDED' },
    });
    expect(prisma.auditLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          actorUserId: 'admin-1',
          actorEmail: 'root@brainstack.test',
          workspaceId: 'w1',
          workspaceName: 'Acme',
          action: 'workspace.suspend',
          details: { from: 'ACTIVE', to: 'SUSPENDED', reason: 'abuse' },
        },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['update-op', 'audit-op']);
    expect(cache.invalidate).toHaveBeenCalledWith('cb_1');
  });

  it('logs unsuspend and a plan change as separate entries', async () => {
    const { prisma, service } = setup();
    prisma.workspace.findUnique.mockResolvedValue({
      ...current,
      status: 'SUSPENDED',
    });
    prisma.workspace.findUniqueOrThrow.mockResolvedValue(row('w1'));

    await service.updateWorkspace(actor, 'w1', {
      status: 'ACTIVE',
      plan: 'STARTER',
    });

    const data = (
      (prisma.auditLog.createMany.mock.calls as unknown[][])[0][0] as {
        data: { action: string }[];
      }
    ).data;
    expect(data.map((d) => d.action)).toEqual([
      'workspace.unsuspend',
      'workspace.set_plan',
    ]);
  });

  it('changes and logs nothing when the values are already set', async () => {
    const { prisma, cache, service } = setup();
    prisma.workspace.findUnique.mockResolvedValue(current);
    prisma.workspace.findUniqueOrThrow.mockResolvedValue(row('w1'));

    await service.updateWorkspace(actor, 'w1', {
      status: 'ACTIVE',
      plan: 'BETA',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });
});

describe('admin module confinement', () => {
  it('never reads conversations, messages or leads (counts only: count and groupBy on conversations and leads), and uses no raw SQL', () => {
    const dir = __dirname;
    const offenders = fs
      .readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) =>
        /\.(message|knowledgeChunk|product)\b|\.(conversation|lead)\.(?!count\(|groupBy\()|\$queryRaw|\$executeRaw/.test(
          fs.readFileSync(path.join(dir, f), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});

describe('AdminService usage (M6-12)', () => {
  const config = {
    llmPriceInPerMillion: 1,
    llmPriceOutPerMillion: 2,
    platformKeyShare: 0,
    planPriceUsd: { BETA: 0, STARTER: 29, GROWTH: 99 },
  };
  function usageSetup() {
    const s = setup();
    const prisma = Object.assign(s.prisma, {
      usageCounter: { findMany: jest.fn().mockResolvedValue([]) },
      conversation: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      lead: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    });
    const service = new AdminService(
      prisma as never,
      s.cache as never,
      { get: () => config } as never,
      s.storage as never,
    );
    service.now = () => new Date('2026-10-17T10:00:00Z');
    return { prisma, service };
  }

  it('overview joins counters, conversations and leads and totals them', async () => {
    const { prisma, service } = usageSetup();
    prisma.workspace.findMany.mockResolvedValue([
      { id: 'a', name: 'A', plan: 'STARTER', status: 'ACTIVE' },
      { id: 'b', name: 'B', plan: 'BETA', status: 'ACTIVE' },
    ]);
    prisma.usageCounter.findMany.mockResolvedValue([
      {
        workspaceId: 'a',
        messages: 10,
        previewMessages: 2,
        tokensIn: BigInt(1_000_000),
        tokensOut: BigInt(500_000),
      },
    ]);
    prisma.conversation.groupBy.mockResolvedValue([
      { workspaceId: 'a', _count: { _all: 4 } },
    ]);
    prisma.lead.groupBy.mockResolvedValue([
      { workspaceId: 'a', _count: { _all: 1 } },
    ]);

    const res = await service.usageOverview();

    expect(res.period).toBe('2026-10');
    expect(res.items[0]).toMatchObject({
      workspaceId: 'a',
      conversations: 4,
      messages: 10,
      leads: 1,
      estimatedCostUsd: 2,
      platformCostUsd: 0,
      ownKeyCostUsd: 2,
      revenueUsd: 29,
      profitUsd: 29,
    });
    expect(res.items[1]).toMatchObject({ messages: 0, revenueUsd: 0 });
    expect(res.totals).toMatchObject({ messages: 10, revenueUsd: 29 });
  });

  it('workspace detail lists six months, newest first, and 404s for an unknown workspace', async () => {
    const { prisma, service } = usageSetup();
    prisma.workspace.findUnique.mockResolvedValueOnce(null);
    await expect(service.workspaceUsage('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.workspace.findUnique.mockResolvedValue({
      id: 'a',
      name: 'A',
      plan: 'GROWTH',
    });
    prisma.usageCounter.findMany.mockResolvedValue([
      {
        period: '2026-09',
        messages: 3,
        previewMessages: 0,
        tokensIn: BigInt(10),
        tokensOut: BigInt(20),
      },
    ]);
    prisma.conversation.count.mockResolvedValue(2);
    const res = await service.workspaceUsage('a');
    expect(res.months.map((m) => m.period)).toEqual([
      '2026-10',
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
    ]);
    expect(res.months[1]).toMatchObject({
      messages: 3,
      tokensIn: 10,
      conversations: 2,
      revenueUsd: 99,
    });
    expect(res.months[0].messages).toBe(0);
  });
});

describe('AdminService.deleteWorkspace (M7-35)', () => {
  const target = {
    id: 'w1',
    name: 'Acme',
    slug: 'acme',
    plan: 'BETA',
    _count: { chatbots: 1, members: 2 },
    chatbots: [{ publicId: 'cb_1' }],
    sources: [{ fileKey: 'workspaces/w1/documents/x/a.pdf' }],
  };
  function deleteSetup() {
    const s = setup();
    const prisma = Object.assign(s.prisma, {
      workspace: {
        ...s.prisma.workspace,
        delete: jest.fn().mockReturnValue('delete-op'),
      },
    });
    prisma.auditLog = Object.assign(prisma.auditLog, {
      create: jest.fn().mockReturnValue('audit-op'),
    });
    prisma.workspace.findUnique.mockResolvedValue(target);
    return { ...s, prisma };
  }

  it('refuses a missing workspace and a wrong slug, and changes nothing', async () => {
    const { prisma, service, storage } = deleteSetup();
    prisma.workspace.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.deleteWorkspace(actor, 'w1', { confirmSlug: 'acme' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.deleteWorkspace(actor, 'w1', { confirmSlug: 'acme-x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.deleteForWorkspace).not.toHaveBeenCalled();
  });

  it('audits and deletes in one transaction, then clears the widget cache and the files', async () => {
    const { prisma, service, cache, storage } = deleteSetup();
    storage.deleteForWorkspace.mockResolvedValue(1);

    const res = await service.deleteWorkspace(actor, 'w1', {
      confirmSlug: 'acme',
      reason: 'Test account',
    });

    expect(res).toEqual({ deleted: true, filesDeleted: 1 });
    expect(prisma.$transaction).toHaveBeenCalledWith(['audit-op', 'delete-op']);
    const audit = (prisma.auditLog.create.mock.calls as unknown[][])[0][0] as {
      data: { action: string; details: Record<string, unknown> };
    };
    expect(audit.data.action).toBe('workspace.delete');
    expect(audit.data.details).toMatchObject({
      slug: 'acme',
      files: 1,
      reason: 'Test account',
    });
    expect(cache.invalidate).toHaveBeenCalledWith('cb_1');
    expect(storage.deleteForWorkspace).toHaveBeenCalledWith('w1', [
      'workspaces/w1/documents/x/a.pdf',
    ]);
  });

  it('still succeeds when the storage cleanup fails', async () => {
    const { service, storage } = deleteSetup();
    storage.deleteForWorkspace.mockRejectedValue(new Error('storage down'));

    await expect(
      service.deleteWorkspace(actor, 'w1', { confirmSlug: 'acme' }),
    ).resolves.toEqual({ deleted: true, filesDeleted: 0 });
  });
});

describe('AdminService.supportView (M7-35)', () => {
  it('404s for a missing workspace', async () => {
    const { prisma, service } = setup();
    prisma.workspace.findUnique.mockResolvedValue(null);
    await expect(service.supportView(actor, 'w1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the setup and writes one audit row', async () => {
    const s = setup();
    const prisma = Object.assign(s.prisma, {
      faq: { findMany: jest.fn().mockResolvedValue([{ id: 'f1' }]) },
      customAnswer: { findMany: jest.fn().mockResolvedValue([]) },
      knowledgeSource: { findMany: jest.fn().mockResolvedValue([]) },
    });
    prisma.auditLog = Object.assign(prisma.auditLog, {
      create: jest.fn().mockResolvedValue({}),
    });
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1', name: 'Acme' });

    const res = await s.service.supportView(actor, 'w1');

    expect(res.faqs).toEqual([{ id: 'f1' }]);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(
      (prisma.auditLog.create.mock.calls as unknown[][])[0][0],
    ).toMatchObject({
      data: { action: 'workspace.support_view', workspaceId: 'w1' },
    });
  });
});
