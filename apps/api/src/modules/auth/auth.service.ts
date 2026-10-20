import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  EmailTokenType,
  Prisma,
  User,
  Workspace,
} from '../../generated/prisma/client';
import { EmailService, OutgoingEmail } from '../email/email.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { runAsSystem } from '../../tenancy/tenant-context';
import { WorkspaceAccessService } from '../../tenancy/workspace-access.service';
import { PasswordResetQueue } from './password-reset.queue';
import {
  accountExistsMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from './auth-emails';
import { AuthContext } from './auth-context';
import { RESET_PASSWORD_TTL_MS, VERIFY_EMAIL_TTL_MS } from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  burnPasswordCheck,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from './secrets';
import { IssuedSession, SessionsService } from './sessions.service';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** M7-23: failed logins per email (all IPs together) before replies slow. */
const LOGIN_FREE_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_SECONDS = 15 * MINUTE;
const LOGIN_DELAY_STEP_MS = 500;
const LOGIN_DELAY_MAX_MS = 3000;

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface MeResponse {
  user: Pick<
    User,
    'id' | 'email' | 'name' | 'emailVerifiedAt' | 'isPlatformAdmin'
  >;
  activeWorkspace: Pick<Workspace, 'id' | 'name' | 'slug' | 'status'> | null;
  role: string | null;
  memberships: {
    workspace: Pick<Workspace, 'id' | 'name' | 'slug'>;
    role: string;
  }[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
    private readonly rateLimit: RateLimitService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly access: WorkspaceAccessService,
    private readonly resetQueue: PasswordResetQueue,
  ) {}

  /** M7-37: verification and password-reset mail are off until a mail provider exists. */
  private get emailFeatures(): boolean {
    return this.config.get<boolean>('email.featuresEnabled') === true;
  }

  /**
   * M1-16: user + workspace + OWNER membership + default chatbot in one
   * transaction, then a verification email (best-effort, outside the
   * transaction so a mail failure can't undo the signup).
   *
   * M7-21: the caller learns nothing about whether the address already had
   * an account. A new address gets the verification mail, an existing one
   * a "you already have an account" mail, and both get the same reply. No
   * session is issued; the user signs in after confirming the email.
   */
  async register(dto: RegisterDto, meta: RequestMeta): Promise<void> {
    await this.rateLimit.consume({
      key: `register:ip:${meta.ipAddress}`,
      limit: 5,
      windowSeconds: HOUR,
    });

    // Hash first on both paths so they cost about the same.
    const passwordHash = await hashPassword(dto.password);
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      this.inBackground(() => this.notifyAccountExists(existing));
      return;
    }

    let user: User;
    try {
      user = await runAsSystem('sign up', () =>
        this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              email: dto.email,
              name: dto.name,
              passwordHash,
              // No mail to confirm while email is off (M7-37).
              emailVerifiedAt: this.emailFeatures ? undefined : new Date(),
            },
          });
          await this.workspaces.createWithOwner(
            { name: dto.companyName, ownerUserId: created.id },
            tx,
          );
          return created;
        }),
      );
    } catch (err) {
      // Two signups with the same email racing past the check above.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.user.findUnique({
          where: { email: dto.email },
        });
        if (winner) this.inBackground(() => this.notifyAccountExists(winner));
        return;
      }
      throw err;
    }

    // The mail is not awaited: sending takes seconds (SMTP) and the signup
    // answer must not wait for it (M7-37).
    this.inBackground(() => this.sendVerificationEmail(user));
  }

  /** Runs mail work after the answer; does nothing while email is off. */
  private inBackground(work: () => Promise<void>): void {
    if (!this.emailFeatures) return;
    work().catch((err: unknown) =>
      this.logger.error(`Background email failed: ${String(err)}`),
    );
  }

  private async notifyAccountExists(user: User): Promise<void> {
    await this.sendBestEffort(
      accountExistsMessage(
        user.email,
        user.name,
        this.dashboardLink('/login'),
        this.dashboardLink('/forgot-password'),
      ),
    );
  }

  /** M1-17/M1-18: same error for unknown email and wrong password. */
  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedSession> {
    await this.rateLimit.consume(
      {
        key: `login:ip-email:${meta.ipAddress}:${dto.email}`,
        limit: 5,
        windowSeconds: MINUTE,
      },
      { key: `login:ip:${meta.ipAddress}`, limit: 20, windowSeconds: HOUR },
    );

    // M7-23: many wrong guesses at one address, from any mix of IPs, make
    // every attempt at it slower. Nobody is locked out, so the real owner
    // can still sign in, just later. Counted per email whether or not an
    // account exists, so this doesn't reveal which addresses do.
    const failKey = `login:fail:email:${dto.email}`;
    const failures = await this.rateLimit.peek(
      failKey,
      LOGIN_FAILURE_WINDOW_SECONDS,
    );
    const delayMs = Math.min(
      Math.max(0, failures - LOGIN_FREE_FAILURES) * LOGIN_DELAY_STEP_MS,
      LOGIN_DELAY_MAX_MS,
    );
    if (delayMs > 0) await this.rateLimit.sleep(delayMs);

    // The user's first workspace is found before any workspace is active.
    const user = await runAsSystem('log in', () =>
      this.prisma.user.findUnique({
        where: { email: dto.email },
        include: {
          memberships: { orderBy: { createdAt: 'asc' }, take: 1 },
        },
      }),
    );
    const valid = user
      ? await verifyPassword(user.passwordHash, dto.password)
      : await burnPasswordCheck(dto.password);
    if (!user || !valid) {
      await this.rateLimit.hit(failKey, LOGIN_FAILURE_WINDOW_SECONDS);
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.sessions.create({
      userId: user.id,
      activeWorkspaceId: user.memberships[0]?.workspaceId ?? null,
      ...meta,
    });
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.sessions.revoke(token);
  }

  async me({ user, session }: AuthContext): Promise<MeResponse> {
    // All of the user's workspaces, not just the current one.
    const memberships = await runAsSystem('list my workspaces', () =>
      this.prisma.workspaceMember.findMany({
        where: { userId: user.id },
        include: { workspace: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    // Same rule as WorkspaceGuard, so the dashboard shows the workspace
    // its requests will actually run in.
    const resolved = await this.access.resolveActive(session);
    const active = memberships.find(
      (m) => m.workspaceId === resolved?.workspaceId,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerifiedAt: user.emailVerifiedAt,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      activeWorkspace: active
        ? {
            id: active.workspace.id,
            name: active.workspace.name,
            slug: active.workspace.slug,
            status: active.workspace.status,
          }
        : null,
      role: active?.role ?? null,
      memberships: memberships.map((m) => ({
        workspace: {
          id: m.workspace.id,
          name: m.workspace.name,
          slug: m.workspace.slug,
        },
        role: m.role,
      })),
    };
  }

  /**
   * M1-19: always succeeds from the caller's point of view, so it can't be
   * used to find out which emails have accounts.
   */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    // Per address (so one inbox isn't flooded) and per caller (so this
    // can't be used to mail many strangers).
    await this.rateLimit.consume(
      {
        key: `forgot-password:email:${email}`,
        limit: 3,
        windowSeconds: HOUR,
      },
      {
        key: `forgot-password:ip:${meta.ipAddress}`,
        limit: 10,
        windowSeconds: HOUR,
      },
    );

    // Known or not, the answer is the same and equally fast: the lookup,
    // the token and the mail all happen in the queued job (M7-24). With
    // email off nothing is queued, since nothing could be sent (M7-37).
    if (!this.emailFeatures) return;
    await this.resetQueue.enqueue(email);
  }

  /**
   * The queued half of forgotPassword (M7-24). Users and email tokens are
   * platform tables (no workspace), so this needs no tenant context. A send
   * that throws is retried by the queue.
   */
  async sendPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = await this.issueEmailToken(
      user.id,
      EmailTokenType.RESET_PASSWORD,
      RESET_PASSWORD_TTL_MS,
    );
    await this.email.send(
      resetPasswordMessage(
        user.email,
        user.name,
        this.dashboardLink('/reset-password', token),
      ),
    );
  }

  /**
   * M1-19: sets the new password and logs out every session of that user
   * (D-2 §2.1). The link arrived by email, so it also proves the address.
   */
  async resetPassword(
    token: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    // Hashing a password is deliberately slow; without a limit an anonymous
    // caller could keep the CPU busy with bad tokens (M7-2).
    await this.rateLimit.consume({
      key: `reset-password:ip:${meta.ipAddress}`,
      limit: 10,
      windowSeconds: HOUR,
    });
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const userId = await this.consumeEmailToken(
        tx,
        token,
        EmailTokenType.RESET_PASSWORD,
      );
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
      await this.sessions.revokeAllForUser(userId, tx);
    });
  }

  /** M1-20 */
  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    await this.rateLimit.consume({
      key: `verify-email:ip:${meta.ipAddress}`,
      limit: 30,
      windowSeconds: HOUR,
    });
    await this.prisma.$transaction(async (tx) => {
      const userId = await this.consumeEmailToken(
        tx,
        token,
        EmailTokenType.VERIFY_EMAIL,
      );
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
  }

  /** M1-20 */
  async resendVerification(user: User): Promise<void> {
    if (user.emailVerifiedAt || !this.emailFeatures) return;
    await this.rateLimit.consume({
      key: `resend-verification:email:${user.email}`,
      limit: 3,
      windowSeconds: HOUR,
    });
    await this.sendVerificationEmail(user);
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const token = await this.issueEmailToken(
      user.id,
      EmailTokenType.VERIFY_EMAIL,
      VERIFY_EMAIL_TTL_MS,
    );
    await this.sendBestEffort(
      verifyEmailMessage(
        user.email,
        user.name,
        this.dashboardLink('/verify-email', token),
      ),
    );
  }

  /** New one-time token; any earlier unused token of the same type dies. */
  private async issueEmailToken(
    userId: string,
    type: EmailTokenType,
    ttlMs: number,
  ): Promise<string> {
    const token = generateToken();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailToken.create({
        data: {
          userId,
          type,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);
    return token;
  }

  /**
   * Marks the token used and returns its user. The conditional update
   * makes a token single-use even if two requests race with it.
   */
  private async consumeEmailToken(
    tx: Prisma.TransactionClient,
    token: string,
    type: EmailTokenType,
  ): Promise<string> {
    const where = {
      tokenHash: hashToken(token),
      type,
      usedAt: null,
      expiresAt: { gt: new Date() },
    };
    const record = await tx.emailToken.findFirst({ where });
    const { count } = await tx.emailToken.updateMany({
      where,
      data: { usedAt: new Date() },
    });
    if (!record || count === 0) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    return record.userId;
  }

  private dashboardLink(path: string, token?: string): string {
    const base = this.config.get<string>('dashboardUrl');
    return token === undefined
      ? `${base}${path}`
      : `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  private async sendBestEffort(message: OutgoingEmail): Promise<void> {
    try {
      await this.email.send(message);
    } catch (err) {
      this.logger.error(
        `Could not send "${message.subject}" email: ${(err as Error).message}`,
      );
    }
  }
}
