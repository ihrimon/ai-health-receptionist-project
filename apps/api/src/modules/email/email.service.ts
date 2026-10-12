import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Best-effort: callers must never fail because email isn't configured or
 * a send fails. Unconfigured (no EMAIL_USER/EMAIL_APP_PASSWORD) is a
 * normal, silent no-op — logged once at startup, not on every send.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromUser: string;
  private readonly fromName: string;
  private readonly isProduction: boolean;

  constructor(private readonly config: ConfigService) {
    this.fromUser = this.config.get<string>('email.gmailUser') ?? '';
    this.fromName =
      this.config.get<string>('email.fromName') ?? 'BrainStack AI Receptionist';
    const pass = this.config.get<string>('email.gmailAppPassword') ?? '';
    this.isProduction = this.config.get<string>('nodeEnv') === 'production';

    if (this.fromUser && pass) {
      this.transporter = createTransport({
        service: 'gmail',
        auth: { user: this.fromUser, pass },
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        'EMAIL_USER/EMAIL_APP_PASSWORD not configured — outgoing email is disabled.',
      );
    }
  }

  async send({ to, subject, html }: OutgoingEmail): Promise<void> {
    if (!this.transporter) {
      // Without SMTP in development, show the email (with its verify/reset
      // link) in the log so auth flows can still be tested end to end.
      if (!this.isProduction) {
        this.logger.log(
          `Email disabled, not sent. To: ${to} | ${subject}\n${html}`,
        );
      }
      return;
    }

    await this.transporter.sendMail({
      from: `"${this.fromName}" <${this.fromUser}>`,
      to,
      subject,
      html,
    });
  }
}
