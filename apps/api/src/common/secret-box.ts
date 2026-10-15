import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
// Only for development and tests; production must set its own key.
const DEV_SECRET = 'brainstack-dev-only-llm-key-secret';

/**
 * Encrypts secrets stored in the database (workspaces' LLM API keys,
 * M3-21) with AES-256-GCM. Stored form: `v1:<iv>:<tag>:<ciphertext>`, all
 * base64. GCM's tag makes a changed or wrong-key value fail to decrypt
 * instead of returning garbage.
 */
@Injectable()
export class SecretBox {
  private readonly logger = new Logger(SecretBox.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    let secret = config.get<string>('security.llmKeyEncryptionKey') ?? '';
    if (!secret && config.get<string>('nodeEnv') !== 'production') {
      this.logger.warn(
        'LLM_KEY_ENCRYPTION_KEY is not set; using the development key.',
      );
      secret = DEV_SECRET;
    }
    // SHA-256 turns any secret into the 32 bytes AES-256 needs; the
    // secret itself should be random (openssl rand -base64 32).
    this.key = secret ? createHash('sha256').update(secret).digest() : null;
  }

  encrypt(plain: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64'),
      )
      .join(':');
  }

  decrypt(stored: string): string {
    const key = this.requireKey();
    const [version, iv, tag, data] = stored.split(':');
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Unrecognised encrypted value');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Lazy, so a missing production key breaks only the features that need it. */
  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'Saving API keys is not set up on this server (LLM_KEY_ENCRYPTION_KEY).',
      );
    }
    return this.key;
  }
}
