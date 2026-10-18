import { escapeHtml } from '../../common/escape-html';
import { OutgoingEmail } from '../email/email.service';

function layout(name: string, intro: string, link: string, action: string) {
  return `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${intro}</p>
    <p><a href="${escapeHtml(link)}">${action}</a></p>
    <p style="color:#666;font-size:13px">If the button doesn't work, copy this link into your browser:<br>${escapeHtml(link)}</p>
    <p style="color:#666;font-size:13px">If you didn't request this, you can ignore this email.</p>
  `;
}

export function verifyEmailMessage(
  to: string,
  name: string,
  link: string,
): OutgoingEmail {
  return {
    to,
    subject: 'Confirm your email address',
    html: layout(
      name,
      'Please confirm your email address. The link is valid for 24 hours.',
      link,
      'Confirm email',
    ),
  };
}

export function resetPasswordMessage(
  to: string,
  name: string,
  link: string,
): OutgoingEmail {
  return {
    to,
    subject: 'Reset your password',
    html: layout(
      name,
      'We received a request to reset your password. The link is valid for 1 hour and can be used once.',
      link,
      'Choose a new password',
    ),
  };
}

/** M7-21: sent instead of a verification mail when the address is taken. */
export function accountExistsMessage(
  to: string,
  name: string,
  loginLink: string,
  resetLink: string,
): OutgoingEmail {
  return {
    to,
    subject: 'You already have an account',
    html: `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Someone tried to sign up with this email address, but it already has an account.</p>
    <p><a href="${escapeHtml(loginLink)}">Sign in</a></p>
    <p style="color:#666;font-size:13px">Forgot your password? <a href="${escapeHtml(resetLink)}">Reset it here</a>.</p>
    <p style="color:#666;font-size:13px">If this wasn't you, you can ignore this email.</p>
  `,
  };
}
