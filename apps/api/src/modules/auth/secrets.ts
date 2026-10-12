import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'crypto';

/** Random opaque token for session cookies and emailed links. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored as SHA-256 hashes, so a leaked database can't be used
 * to log in or reset passwords. (They're high-entropy, so a fast hash is
 * enough; passwords get argon2.)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** argon2id (the @node-rs/argon2 default) with the library's default cost. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hash: treat as a mismatch rather than a 500.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real password check. Login calls it for
 * unknown emails so response timing doesn't reveal which emails have
 * accounts.
 */
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= hashPassword(generateToken());
  await verifyPassword(await dummyHash, password);
  return false;
}
