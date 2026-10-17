import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthContext } from './auth-context';
import { CurrentAuth, Public } from './auth-context';
import { SESSION_COOKIE } from './auth.constants';
import { AuthService, MeResponse, RequestMeta } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto, VerifyEmailDto } from './dto/token.dto';
import { IssuedSession } from './sessions.service';

/**
 * Locally the dashboard (localhost:3000) and API (localhost:3001) are
 * different origins but the same *site*, so a Lax cookie is sent on
 * cross-origin fetches fine. Deployed on genuinely different sites (e.g. a
 * vercel.app dashboard + onrender.com API), a cross-site fetch only carries
 * the cookie if it's SameSite=None, which requires Secure. CSRF is covered
 * by the X-Requested-With check in main.ts plus the CORS allow-list either
 * way.
 */
function sessionCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction
    ? { httpOnly: true, sameSite: 'none', secure: true, path: '/' }
    : { httpOnly: true, sameSite: 'lax', path: '/' };
}

function setSessionCookie(res: Response, session: IssuedSession): void {
  res.cookie(SESSION_COOKIE, session.token, {
    ...sessionCookieOptions(),
    expires: session.expiresAt,
  });
}

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

/** D-2 §2.1 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, workspace, session } = await this.authService.register(
      dto,
      requestMeta(req),
    );
    setSessionCookie(res, session);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.authService.login(dto, requestMeta(req));
    setSessionCookie(res, session);
  }

  /** Public so an expired session can still clear its cookie. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(
      req.cookies?.[SESSION_COOKIE] as string | undefined,
    );
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.authService.me(auth);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.authService.forgotPassword(dto.email, requestMeta(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    return this.authService.resetPassword(
      dto.token,
      dto.newPassword,
      requestMeta(req),
    );
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request): Promise<void> {
    return this.authService.verifyEmail(dto.token, requestMeta(req));
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  resendVerification(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.authService.resendVerification(auth.user);
  }
}
