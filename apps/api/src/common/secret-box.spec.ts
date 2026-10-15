import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretBox } from './secret-box';

const box = (values: Record<string, unknown>) =>
  new SecretBox(new ConfigService(values));

describe('SecretBox', () => {
  const dev = box({ nodeEnv: 'development' });

  it('round-trips a secret without storing it in plain text', () => {
    const stored = dev.encrypt('sk-test-1234567890');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('sk-test');
    expect(dev.decrypt(stored)).toBe('sk-test-1234567890');
  });

  it('uses a fresh IV, so the same secret encrypts differently', () => {
    expect(dev.encrypt('same')).not.toBe(dev.encrypt('same'));
  });

  it('refuses a value encrypted with another key', () => {
    const other = box({
      nodeEnv: 'production',
      security: { llmKeyEncryptionKey: 'another-secret' },
    });
    expect(() => dev.decrypt(other.encrypt('sk-x'))).toThrow();
  });

  it('refuses a tampered value', () => {
    const [v, iv, tag, data] = dev.encrypt('sk-test').split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() =>
      dev.decrypt([v, iv, tag, flipped.toString('base64')].join(':')),
    ).toThrow();
  });

  it('has no key in production until LLM_KEY_ENCRYPTION_KEY is set', () => {
    const prod = box({ nodeEnv: 'production' });
    expect(() => prod.encrypt('sk-x')).toThrow(ServiceUnavailableException);
  });
});
