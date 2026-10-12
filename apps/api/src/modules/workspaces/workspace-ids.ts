import { randomInt } from 'crypto';

const ALPHANUMERIC =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER_ALPHANUMERIC = '0123456789abcdefghijklmnopqrstuvwxyz';

// workspaces.slug is VARCHAR(60); leave room for a "-xxxxxx" suffix.
const SLUG_BASE_MAX = 50;

function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Chatbot.publicId: "cb_" + 16 random characters, used in embed snippets. */
export function generateChatbotPublicId(): string {
  return `cb_${randomString(ALPHANUMERIC, 16)}`;
}

/**
 * URL-safe slug from a workspace name, matching the workspaces_slug_format
 * CHECK. Accents are stripped; a name with no Latin letters or digits at
 * all (e.g. Bangla only) falls back to "workspace".
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_BASE_MAX)
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

/** `base` plus a random suffix, for when `base` is already taken. */
export function withRandomSuffix(base: string): string {
  return `${base}-${randomString(LOWER_ALPHANUMERIC, 6)}`;
}
