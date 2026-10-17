import type { LeadSummary } from '@brainstack/shared';
import { escapeHtml } from '../../common/escape-html';

export interface LeadEmailInput {
  lead: LeadSummary;
  /** The chatbot's name from its config (identity.botName). */
  botName: string;
  /** The dashboard's base URL, e.g. https://app.example.com. */
  dashboardUrl: string;
}

/** Header-safe one-line text: no line breaks, at most `max` characters. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The subject of the new-lead email (M5-6). Visitor text goes in the
 * subject as plain text, so line breaks are removed (no header tricks).
 */
export function leadEmailSubject({ lead, botName }: LeadEmailInput): string {
  const who = lead.name ?? lead.email ?? lead.phone ?? 'a visitor';
  return oneLine(`New lead from ${botName}: ${who}`, 150);
}

/**
 * The HTML body of the new-lead email (M5-6, FR-8.7). Everything the
 * visitor typed (name, email, phone, answers, source page) and the
 * company's question texts are HTML-escaped. The source page is shown as
 * text, not a link: the widget reports it, so it could be any URL.
 */
export function leadEmailHtml({
  lead,
  botName,
  dashboardUrl,
}: LeadEmailInput): string {
  const base = dashboardUrl.replace(/\/+$/, '');
  const rows: [string, string][] = [];
  if (lead.name) rows.push(['Name', lead.name]);
  if (lead.email) rows.push(['Email', lead.email]);
  if (lead.phone) rows.push(['Phone', lead.phone]);
  for (const a of lead.answers) {
    rows.push([a.question ?? `Question ${a.questionId}`, a.answer]);
  }
  if (lead.sourceUrl) rows.push(['Source page', lead.sourceUrl]);

  const cell = 'padding:6px 12px;border-bottom:1px solid #eee;';
  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="${cell}color:#666;vertical-align:top">${escapeHtml(label)}</td><td style="${cell}white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
    )
    .join('\n');

  const links = [
    lead.conversationId
      ? `<a href="${escapeHtml(`${base}/app/conversations/${encodeURIComponent(lead.conversationId)}`)}">View the conversation</a>`
      : null,
    `<a href="${escapeHtml(`${base}/app/leads`)}">All leads</a>`,
  ].filter(Boolean);

  return `
    <p>Your chatbot <strong>${escapeHtml(botName)}</strong> captured a new lead.</p>
    <table style="border-collapse:collapse;font-size:14px">
${table}
    </table>
    <p>${links.join(' · ')}</p>
    <p style="color:#666;font-size:13px">You get this email because you are an owner of this workspace. Later details from the same chat are added to the lead in the dashboard; no new email is sent for them.</p>
  `;
}
