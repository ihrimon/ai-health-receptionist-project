import {
  burnPasswordCheck,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from './secrets';

describe('auth secrets', () => {
  it('hashes passwords with argon2id and verifies them', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('treats a malformed hash as a mismatch instead of throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('burnPasswordCheck always fails', async () => {
    await expect(burnPasswordCheck('anything')).resolves.toBe(false);
  });

  it('generates distinct URL-safe tokens', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes tokens to a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
