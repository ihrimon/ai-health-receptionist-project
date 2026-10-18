import {
  type CreateLlmKey,
  LLM_KEY_LIMITS,
  type LlmKeyView,
  type UpdateLlmKey,
} from '@brainstack/shared';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { SecretBox } from '../../common/secret-box';
import type { WorkspaceLlmKey } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import {
  TENANT_PRISMA,
  type TenantDb,
  type TenantPrisma,
} from '../../tenancy/tenant-prisma';
import { LlmChatClient } from '../llm/llm-chat.client';
import type { LlmCredentialSnapshot } from '../llm/llm-key-manager';
import { orNotFound } from '../knowledge-base/knowledge-errors';

function toView(row: WorkspaceLlmKey): LlmKeyView {
  return {
    id: row.id,
    provider: row.provider as LlmKeyView['provider'],
    model: row.model,
    keyLast4: row.keyLast4,
    isActive: row.isActive,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const last4 = (apiKey: string) => apiKey.slice(-4);

/**
 * A workspace's own LLM API keys (M3-21). Keys are verified with one real
 * call before they're saved, stored encrypted, and never returned.
 */
@Injectable()
export class LlmKeysService {
  private readonly logger = new Logger(LlmKeysService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly secrets: SecretBox,
    private readonly llm: LlmChatClient,
  ) {}

  async list(): Promise<LlmKeyView[]> {
    const rows = await this.db.workspaceLlmKey.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toView);
  }

  async create(body: CreateLlmKey): Promise<LlmKeyView> {
    const count = await this.db.workspaceLlmKey.count();
    if (count >= LLM_KEY_LIMITS.maxKeys) {
      throw new ConflictException(
        `A workspace can have at most ${LLM_KEY_LIMITS.maxKeys} API keys`,
      );
    }
    await this.llm.verify(body);
    const row = await this.db.workspaceLlmKey.create({
      data: {
        workspaceId: requireTenant().workspaceId,
        provider: body.provider,
        model: body.model,
        apiKeyEncrypted: this.secrets.encrypt(body.apiKey),
        keyLast4: last4(body.apiKey),
      },
    });
    return toView(row);
  }

  async update(id: string, body: UpdateLlmKey): Promise<LlmKeyView> {
    const current = await orNotFound('API key', () =>
      this.db.workspaceLlmKey.findUniqueOrThrow({ where: { id } }),
    );
    // Only a new key or model needs a real call; switching on/off doesn't.
    if (body.apiKey !== undefined || body.model !== undefined) {
      await this.llm.verify({
        provider: current.provider,
        model: body.model ?? current.model,
        apiKey: body.apiKey ?? this.secrets.decrypt(current.apiKeyEncrypted),
      });
    }
    const row = await orNotFound('API key', () =>
      this.db.workspaceLlmKey.update({
        where: { id },
        data: {
          model: body.model,
          isActive: body.isActive,
          ...(body.apiKey !== undefined && {
            apiKeyEncrypted: this.secrets.encrypt(body.apiKey),
            keyLast4: last4(body.apiKey),
          }),
        },
      }),
    );
    return toView(row);
  }

  async remove(id: string): Promise<void> {
    await orNotFound('API key', () =>
      this.db.workspaceLlmKey.delete({ where: { id } }),
    );
  }

  /** The current workspace's active keys, decrypted, oldest first: what chat uses. */
  async activeCredentials(
    db: TenantDb = this.db,
  ): Promise<LlmCredentialSnapshot[]> {
    const rows = await db.workspaceLlmKey.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      apiKey: this.secrets.decrypt(row.apiKeyEncrypted),
    }));
  }

  /** Best effort: a failed write never fails the chat turn. */
  async markUsed(id: string): Promise<void> {
    try {
      await this.db.workspaceLlmKey.update({
        where: { id },
        data: { lastUsedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Couldn't mark API key ${id} used: ${String(err)}`);
    }
  }
}
