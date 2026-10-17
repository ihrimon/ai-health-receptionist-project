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
