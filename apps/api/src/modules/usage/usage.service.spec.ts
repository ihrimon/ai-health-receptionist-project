import { Test } from '@nestjs/testing';
import { WorkspaceRole } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { periodOf, UsageService } from './usage.service';

describe('periodOf', () => {
  it('is the UTC calendar month', () => {
    expect(periodOf(new Date('2026-10-16T08:00:00Z'))).toBe('2026-10');
    expect(periodOf(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
    expect(periodOf(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });
});

describe('UsageService', () => {
  const db = { usageCounter: { upsert: jest.fn(), findUnique: jest.fn() } };
  let service: UsageService;
  const inTenant = <T>(fn: () => Promise<T>) =>
    runWithTenant(
      { workspaceId: 'ws-1', userId: 'u-1', role: WorkspaceRole.VIEWER },
      fn,
    );

  beforeEach(async () => {
    jest.resetAllMocks();
    db.usageCounter.upsert.mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [UsageService, { provide: TENANT_PRISMA, useValue: db }],
    }).compile();
    service = moduleRef.get(UsageService);
    service.now = () => new Date('2026-10-16T08:00:00Z');
  });

  it("counts a visitor's answer in this month's row", async () => {
    await inTenant(() =>
      service.record({ preview: false, tokensIn: 120, tokensOut: 8 }),
    );

    expect(db.usageCounter.upsert).toHaveBeenCalledWith({
      where: { workspaceId_period: { workspaceId: 'ws-1', period: '2026-10' } },
      create: {
        workspaceId: 'ws-1',
        period: '2026-10',
        messages: 1,
        previewMessages: 0,
        tokensIn: 120,
        tokensOut: 8,
      },
      update: {
        messages: { increment: 1 },
        previewMessages: { increment: 0 },
        tokensIn: { increment: 120 },
        tokensOut: { increment: 8 },
      },
    });
  });

  it('counts a Test chat answer apart from live ones', async () => {
    await inTenant(() =>
      service.record({ preview: true, tokensIn: 0, tokensOut: 0 }),
    );
    const [[args]] = db.usageCounter.upsert.mock.calls as [
      [{ update: Record<string, { increment: number }> }],
    ];
    expect(args.update.messages.increment).toBe(0);
    expect(args.update.previewMessages.increment).toBe(1);
  });

  it('retries once when two first answers of a month race', async () => {
    db.usageCounter.upsert
      .mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      )
      .mockResolvedValueOnce({});
    await inTenant(() =>
      service.record({ preview: false, tokensIn: 1, tokensOut: 1 }),
    );
    expect(db.usageCounter.upsert).toHaveBeenCalledTimes(2);
  });

  it('lets any other error through', async () => {
    db.usageCounter.upsert.mockRejectedValue(new Error('db down'));
    await expect(
      inTenant(() =>
        service.record({ preview: false, tokensIn: 1, tokensOut: 1 }),
      ),
    ).rejects.toThrow('db down');
  });

  it('reports zeros before the first answer of the month', async () => {
    db.usageCounter.findUnique.mockResolvedValue(null);
    await expect(inTenant(() => service.current())).resolves.toEqual({
      period: '2026-10',
      messages: 0,
      previewMessages: 0,
      tokensIn: 0,
      tokensOut: 0,
      limit: null,
    });
  });

  it('reports the month so far, with big token counts as numbers', async () => {
    db.usageCounter.findUnique.mockResolvedValue({
      messages: 12,
      previewMessages: 3,
      tokensIn: BigInt(34000),
      tokensOut: BigInt(2100),
    });
    await expect(inTenant(() => service.current())).resolves.toMatchObject({
      messages: 12,
      previewMessages: 3,
      tokensIn: 34000,
      tokensOut: 2100,
    });
  });
});
