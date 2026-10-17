import {
  analyticsOverviewQuerySchema,
  analyticsRange,
  analyticsTopQuestionsQuerySchema,
  analyticsUnansweredQuerySchema,
  lastDays,
} from '@brainstack/shared';
import { Test } from '@nestjs/testing';
import { WorkspaceRole } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { AnalyticsService, buildOverview } from './analytics.service';

const NOW = new Date('2026-10-17T22:30:00Z');

describe('analyticsOverviewQuerySchema', () => {
  it('accepts days and nothing', () => {
    expect(analyticsOverviewQuerySchema.parse({})).toEqual({});
    expect(
      analyticsOverviewQuerySchema.parse({
        from: '2026-10-01',
        to: '2026-10-17',
      }),
    ).toEqual({ from: '2026-10-01', to: '2026-10-17' });
  });

  it('rejects bad days, reversed or too long ranges and unknown fields', () => {
    const bad = [
      { from: 'last week' },
      { from: '2026-02-30' },
      { to: '2026-10-17T00:00:00Z' },
      { from: '2026-10-18', to: '2026-10-17' },
      { from: '2024-01-01', to: '2026-10-17' },
      { from: '2020-01-01' },
      { chatbotId: 'x' },
    ];
    for (const query of bad) {
      expect(analyticsOverviewQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe('analyticsRange', () => {
  it('defaults to the last 30 UTC days, today included', () => {
    expect(analyticsRange({}, NOW)).toEqual({
      from: '2026-09-18',
      to: '2026-10-17',
    });
    expect(analyticsRange({ to: '2026-03-01' }, NOW)).toEqual({
      from: '2026-01-31',
      to: '2026-03-01',
    });
    expect(analyticsRange({ from: '2026-10-10' }, NOW)).toEqual({
      from: '2026-10-10',
      to: '2026-10-17',
    });
  });

  it('lastDays gives the dashboard presets', () => {
    expect(lastDays(7, NOW)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(lastDays(1, NOW)).toEqual({ from: '2026-10-17', to: '2026-10-17' });
  });
});

describe('buildOverview', () => {
  it('fills missing days with zeros and totals the range', () => {
    const overview = buildOverview(
      { from: '2026-02-27', to: '2026-03-02' },
      {
        conversations: [
          { day: '2026-02-27', conversations: 2, ratings: 2, ratingSum: 9 },
          { day: '2026-03-01', conversations: 1, ratings: 1, ratingSum: 2 },
        ],
        messages: [
          { day: '2026-02-27', messages: 6, answers: 3, fallbacks: 1 },
          { day: '2026-03-02', messages: 2, answers: 1, fallbacks: 0 },
        ],
        leads: [{ day: '2026-02-28', leads: 1 }],
      },
    );
    expect(overview.daily.map((d) => d.date)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(overview.daily[1]).toEqual({
      date: '2026-02-28',
      conversations: 0,
      messages: 0,
      leads: 1,
      avgRating: null,
      ratings: 0,
    });
    expect(overview.daily[0].avgRating).toBe(4.5);
    expect(overview).toMatchObject({
      timeZone: 'UTC',
      conversations: 3,
      messages: 8,
      leads: 1,
      ratings: 3,
      // (5 + 4 + 2) / 3, weighted by ratings, not the mean of daily means.
      avgRating: 3.67,
      fallbackRate: 0.25,
    });
  });

  it('has null averages when nothing was rated or answered', () => {
    const overview = buildOverview(
      { from: '2026-10-17', to: '2026-10-17' },
      { conversations: [], messages: [], leads: [] },
    );
    expect(overview).toMatchObject({
      conversations: 0,
      avgRating: null,
      fallbackRate: null,
    });
    expect(overview.daily).toHaveLength(1);
  });
});

describe('AnalyticsService', () => {
  it("queries only the current workspace's rows, in the requested range", async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: TENANT_PRISMA, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    const service = moduleRef.get(AnalyticsService);
    service.now = () => NOW;

    const overview = await runWithTenant(
      { workspaceId: 'ws-1', userId: 'u-1', role: WorkspaceRole.VIEWER },
      () => service.overview({ from: '2026-10-11' }),
    );

    expect(overview.daily).toHaveLength(7);
    expect(queryRaw).toHaveBeenCalledTimes(3);
    for (const [sql, ...values] of queryRaw.mock.calls as [
      TemplateStringsArray,
      ...unknown[],
    ][]) {
      expect(sql.join('?')).toContain('workspace_id = ?::uuid');
      expect(values).toContain('ws-1');
      expect(values).toContain('2026-10-11');
      expect(values).toContain('2026-10-17');
      expect(values).not.toContain('ws-2');
    }
  });
});

describe('analyticsUnansweredQuerySchema', () => {
  it('takes the same range and limit as top questions', () => {
    expect(
      analyticsUnansweredQuerySchema.parse({ to: '2026-10-17', limit: '50' }),
    ).toEqual({ to: '2026-10-17', limit: 50 });
    expect(
      analyticsUnansweredQuerySchema.safeParse({ limit: '51' }).success,
    ).toBe(false);
    expect(
      analyticsUnansweredQuerySchema.safeParse({ cursor: 'x' }).success,
    ).toBe(false);
  });
});

describe('analyticsTopQuestionsQuerySchema', () => {
  it('takes the overview range plus a limit', () => {
    expect(analyticsTopQuestionsQuerySchema.parse({})).toEqual({});
    expect(
      analyticsTopQuestionsQuerySchema.parse({
        from: '2026-10-01',
        limit: '5',
      }),
    ).toEqual({ from: '2026-10-01', limit: 5 });
  });

  it('rejects a bad limit, a reversed or too long range and unknown fields', () => {
    const bad = [
      { limit: '0' },
      { limit: '51' },
      { limit: 'many' },
      { limit: '1.5' },
      { from: '2026-10-18', to: '2026-10-17' },
      { from: '2020-01-01' },
      { chatbotId: 'x' },
    ];
    for (const query of bad) {
      expect(analyticsTopQuestionsQuerySchema.safeParse(query).success).toBe(
        false,
      );
    }
  });
});
