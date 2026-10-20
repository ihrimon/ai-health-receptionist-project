import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceRole } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { WorkspaceAccessService } from '../../tenancy/workspace-access.service';
import {
  canonicalTimeZone,
  isTimeZone,
  UpdateWorkspaceDto,
} from './dto/workspace.dto';
import { WorkspacesService } from './workspaces.service';

/** What the DTO makes of a request body, and what is wrong with it. */
async function check(body: object) {
  const dto = plainToInstance(UpdateWorkspaceDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, problems: errors.map((e) => e.property).sort() };
}

describe('UpdateWorkspaceDto (M7-42)', () => {
  it('accepts a full profile and trims it', async () => {
    const { dto, problems } = await check({
      name: '  Acme Ltd  ',
      website: ' https://acme.example.com ',
      industry: ' HVAC ',
      contactEmail: ' Hello@Acme.Example.com ',
      contactPhone: '+1 (347) 433-0432',
      timeZone: 'Asia/Dhaka',
    });
    expect(problems).toEqual([]);
    expect(dto).toMatchObject({
      name: 'Acme Ltd',
      website: 'https://acme.example.com',
      industry: 'HVAC',
      contactEmail: 'hello@acme.example.com',
      contactPhone: '+1 (347) 433-0432',
      timeZone: 'Asia/Dhaka',
    });
  });

  it('accepts any single field', async () => {
    for (const body of [
      { name: 'Acme' },
      { website: 'http://acme.test' },
      { industry: 'Plumbing' },
      { timeZone: 'UTC' },
    ]) {
      expect((await check(body)).problems).toEqual([]);
    }
  });

  it('clears an optional field when it is sent blank or null', async () => {
    const { dto, problems } = await check({
      website: '   ',
      industry: null,
      contactEmail: '',
      contactPhone: ' ',
    });
    expect(problems).toEqual([]);
    expect(dto.website).toBeNull();
    expect(dto.industry).toBeNull();
    expect(dto.contactEmail).toBeNull();
    expect(dto.contactPhone).toBeNull();
  });

  it('refuses a blank or missing-value name, a bad address and a made-up time zone', async () => {
    expect((await check({ name: '   ' })).problems).toEqual(['name']);
    expect((await check({ name: null })).problems).toEqual(['name']);
    expect((await check({ website: 'example.com' })).problems).toEqual([
      'website',
    ]);
    expect((await check({ website: 'javascript:alert(1)' })).problems).toEqual([
      'website',
    ]);
    expect((await check({ contactEmail: 'not-an-email' })).problems).toEqual([
      'contactEmail',
    ]);
    expect((await check({ contactPhone: 'call me' })).problems).toEqual([
      'contactPhone',
    ]);
    expect((await check({ timeZone: 'Mars/Base' })).problems).toEqual([
      'timeZone',
    ]);
    expect((await check({ timeZone: '' })).problems).toEqual(['timeZone']);
  });

  it('refuses fields it does not know, such as the plan or the slug', async () => {
    expect((await check({ plan: 'GROWTH' })).problems).toEqual(['plan']);
    expect((await check({ slug: 'mine' })).problems).toEqual(['slug']);
    expect((await check({ status: 'ACTIVE' })).problems).toEqual(['status']);
  });

  it('knows real time zones and writes them the canonical way', () => {
    expect(isTimeZone('Asia/Dhaka')).toBe(true);
    expect(isTimeZone('Nope/Nowhere')).toBe(false);
    expect(isTimeZone(5)).toBe(false);
    expect(canonicalTimeZone('asia/dhaka')).toBe('Asia/Dhaka');
  });
});

describe('WorkspacesService settings (M7-42)', () => {
  const profileRow = {
    id: 'ws-1',
    name: 'Acme',
    slug: 'acme',
    status: 'ACTIVE',
    plan: 'BETA',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    website: null,
    industry: null,
    contactEmail: null,
    contactPhone: null,
    timeZone: 'UTC',
  };
  const db = {
    workspace: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    workspaceMember: { findMany: jest.fn() },
  };
  let service: WorkspacesService;
  const inTenant = <T>(fn: () => Promise<T>) =>
    runWithTenant(
      { workspaceId: 'ws-1', userId: 'u-1', role: WorkspaceRole.OWNER },
      fn,
    );

  beforeEach(async () => {
    jest.resetAllMocks();
    db.workspace.findUniqueOrThrow.mockResolvedValue(profileRow);
    db.workspace.update.mockResolvedValue(profileRow);
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: PrismaService, useValue: {} },
        { provide: TENANT_PRISMA, useValue: db },
        { provide: WorkspaceAccessService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(WorkspacesService);
  });

  it('reads only the current workspace', async () => {
    await expect(inTenant(() => service.profile())).resolves.toEqual(
      profileRow,
    );
    expect(db.workspace.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-1' } }),
    );
  });

  it('changes only the fields sent, in the current workspace, with a canonical zone', async () => {
    await inTenant(() =>
      service.updateCurrent({
        website: 'https://acme.test',
        industry: null,
        timeZone: 'asia/dhaka',
      }),
    );
    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ws-1' },
        data: {
          website: 'https://acme.test',
          industry: null,
          timeZone: 'Asia/Dhaka',
        },
      }),
    );
  });

  it('refuses an update that changes nothing', async () => {
    await expect(
      inTenant(() => service.updateCurrent({})),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.workspace.update).not.toHaveBeenCalled();
  });

  it('lists the members with name, email, role and since when, and nothing else', async () => {
    db.workspaceMember.findMany.mockResolvedValue([
      {
        role: 'OWNER',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        user: { name: 'Rina', email: 'rina@acme.test' },
      },
    ]);
    const rows = await inTenant(() => service.members());
    expect(rows).toEqual([
      {
        name: 'Rina',
        email: 'rina@acme.test',
        role: 'OWNER',
        joinedAt: new Date('2026-10-01T00:00:00Z'),
      },
    ]);
    const args = (
      db.workspaceMember.findMany.mock.calls as unknown[][]
    )[0][0] as {
      select: { user: { select: object } };
    };
    expect(args.select.user.select).toEqual({ name: true, email: true });
  });
});
