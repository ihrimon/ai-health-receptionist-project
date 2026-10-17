import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { EmailTokenType, Prisma } from '../../generated/prisma/client';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { EmailService } from '../email/email.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { WorkspaceAccessService } from '../../tenancy/workspace-access.service';
import { AuthService } from './auth.service';
import { hashPassword } from './secrets';
import { SessionsService } from './sessions.service';

/** The first argument of a mock's first call. */
const firstArg = <T>(mock: jest.Mock): T =>
  (mock.mock.calls as unknown[][])[0][0] as T;

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: Record<
      'findUnique' | 'findUniqueOrThrow' | 'create' | 'update' | 'updateMany',
      jest.Mock
    >;
    emailToken: Record<'findFirst' | 'updateMany' | 'create', jest.Mock>;
    workspaceMember: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let sessions: Record<'create' | 'revoke' | 'revokeAllForUser', jest.Mock>;
  let workspaces: { createWithOwner: jest.Mock };
  let rateLimit: { consume: jest.Mock };
  let email: { send: jest.Mock };

  const meta = { ipAddress: '1.2.3.4', userAgent: 'jest' };
  const issued = { token: 'raw-session', expiresAt: new Date() };
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword('correct horse battery');
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      emailToken: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      workspaceMember: { findMany: jest.fn() },
      // Interactive transactions get the same mock as their client; the
      // array form just resolves its (already-called) operations.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : Promise.all(arg as unknown[]),
      ),
    };
    sessions = {
      create: jest.fn().mockResolvedValue(issued),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    workspaces = { createWithOwner: jest.fn() };
    rateLimit = { consume: jest.fn() };
    email = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: SessionsService, useValue: sessions },
        { provide: WorkspacesService, useValue: workspaces },
        { provide: RateLimitService, useValue: rateLimit },
        { provide: EmailService, useValue: email },
        { provide: WorkspaceAccessService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://dash.test' },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  const sentLink = () => {
    const html = firstArg<{ html: string }>(email.send).html;
    return /href="([^"]+)"/.exec(html)?.[1];
  };

  describe('register', () => {
    const dto = {
      name: 'Rina',
      email: 'rina@example.com',
      password: 'correct horse battery',
      companyName: 'Acme',
    };

    beforeEach(() => {
      prisma.user.create.mockImplementation(({ data }: { data: object }) => ({
        id: 'u1',
        ...data,
      }));
      workspaces.createWithOwner.mockResolvedValue({ id: 'ws1', name: 'Acme' });
    });

    it('creates user, workspace and session in one transaction', async () => {
      const result = await service.register(dto, meta);

      expect(prisma.$transaction).toHaveBeenCalled();
      const created = firstArg<{
        data: { passwordHash: string };
      }>(prisma.user.create);
      expect(created.data.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(workspaces.createWithOwner).toHaveBeenCalledWith(
        { name: 'Acme', ownerUserId: 'u1' },
        prisma,
      );
      expect(sessions.create).toHaveBeenCalledWith(
        { userId: 'u1', activeWorkspaceId: 'ws1', ...meta },
        prisma,
      );
      expect(result.session).toBe(issued);
    });

    it('rate-limits by IP (5/hour)', async () => {
      await service.register(dto, meta);
      expect(rateLimit.consume).toHaveBeenCalledWith({
        key: 'register:ip:1.2.3.4',
        limit: 5,
        windowSeconds: 3600,
      });
    });

    it('emails a verification link to the dashboard', async () => {
      await service.register(dto, meta);
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'rina@example.com' }),
      );
      expect(sentLink()).toMatch(/^http:\/\/dash\.test\/verify-email\?token=/);
    });

    it('still succeeds when the email fails to send', async () => {
      email.send.mockRejectedValue(new Error('SMTP down'));
      await expect(service.register(dto, meta)).resolves.toBeDefined();
    });

    it('409s on an email that already has an account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'other' });
      await expect(service.register(dto, meta)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('409s when a concurrent signup wins the unique index', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.register(dto, meta)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    const user = () => ({
      id: 'u1',
      email: 'rina@example.com',
      passwordHash,
      memberships: [{ workspaceId: 'ws1' }],
    });

    it('opens a session in the first workspace on the right password', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await expect(
        service.login(
          { email: 'rina@example.com', password: 'correct horse battery' },
          meta,
        ),
      ).resolves.toBe(issued);
      expect(sessions.create).toHaveBeenCalledWith({
        userId: 'u1',
        activeWorkspaceId: 'ws1',
        ...meta,
      });
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user());
      const wrong = await service
        .login({ email: 'rina@example.com', password: 'nope nope nope' }, meta)
        .catch((e: Error) => e);
      const unknown = await service
        .login({ email: 'who@example.com', password: 'nope nope nope' }, meta)
        .catch((e: Error) => e);

      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect((wrong as Error).message).toBe((unknown as Error).message);
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rate-limits by IP+email (5/min) and by IP (20/hour)', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await service.login(
        { email: 'rina@example.com', password: 'correct horse battery' },
        meta,
      );
      expect(rateLimit.consume).toHaveBeenCalledWith(
        {
          key: 'login:ip-email:1.2.3.4:rina@example.com',
          limit: 5,
          windowSeconds: 60,
        },
        { key: 'login:ip:1.2.3.4', limit: 20, windowSeconds: 3600 },
      );
    });
  });

  describe('forgotPassword', () => {
    it('does nothing visible for an unknown email', async () => {
      await expect(
        service.forgotPassword('who@example.com', meta),
      ).resolves.toBeUndefined();
      expect(prisma.emailToken.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('replaces earlier reset tokens and emails a fresh link', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'rina@example.com',
        name: 'Rina',
      });

      await service.forgotPassword('rina@example.com', meta);

      expect(prisma.emailToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          type: EmailTokenType.RESET_PASSWORD,
          usedAt: null,
        },
        data: { usedAt: expect.any(Date) as Date },
      });
      const stored = firstArg<{
        data: { tokenHash: string };
      }>(prisma.emailToken.create);
      const link = sentLink();
      expect(link).toMatch(/^http:\/\/dash\.test\/reset-password\?token=/);
      // The link carries the raw token; only its hash is stored.
      expect(link).not.toContain(stored.data.tokenHash);
    });
  });

  describe('resetPassword', () => {
    it('400s on an invalid, used or expired token', async () => {
      prisma.emailToken.findFirst.mockResolvedValue(null);
      prisma.emailToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.resetPassword('bad', 'brand new password', meta),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('sets the new password, verifies the email and logs out everywhere', async () => {
      prisma.emailToken.findFirst.mockResolvedValue({ userId: 'u1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'u1',
        emailVerifiedAt: null,
      });

      await service.resetPassword('good', 'brand new password', meta);

      const update = firstArg<{
        data: { passwordHash: string; emailVerifiedAt: Date };
      }>(prisma.user.update);
      expect(update.data.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(update.data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1', prisma);
    });
  });

  describe('rate limits on the anonymous email routes (M7-2)', () => {
    it('limits password resets per caller before hashing anything', async () => {
      rateLimit.consume.mockRejectedValue(new Error('limited'));
      await expect(
        service.resetPassword('any', 'brand new password', meta),
      ).rejects.toThrow('limited');
      expect(rateLimit.consume).toHaveBeenCalledWith({
        key: 'reset-password:ip:1.2.3.4',
        limit: 10,
        windowSeconds: 3600,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('limits verification attempts per caller', async () => {
      rateLimit.consume.mockRejectedValue(new Error('limited'));
      await expect(service.verifyEmail('any', meta)).rejects.toThrow('limited');
      expect(rateLimit.consume).toHaveBeenCalledWith({
        key: 'verify-email:ip:1.2.3.4',
        limit: 30,
        windowSeconds: 3600,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('limits forgot-password per address and per caller', async () => {
      await service.forgotPassword('who@example.com', meta);
      expect(rateLimit.consume).toHaveBeenCalledWith(
        {
          key: 'forgot-password:email:who@example.com',
          limit: 3,
          windowSeconds: 3600,
        },
        { key: 'forgot-password:ip:1.2.3.4', limit: 10, windowSeconds: 3600 },
      );
    });
  });

  describe('verifyEmail', () => {
    it('marks the email verified for a valid token', async () => {
      prisma.emailToken.findFirst.mockResolvedValue({ userId: 'u1' });
      await service.verifyEmail('good', meta);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', emailVerifiedAt: null },
        data: { emailVerifiedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('resendVerification', () => {
    it('is a no-op for an already verified user', async () => {
      await service.resendVerification({
        emailVerifiedAt: new Date(),
      } as never);
      expect(rateLimit.consume).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });
  });
});
