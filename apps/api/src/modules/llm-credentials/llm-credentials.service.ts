import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../../database/prisma.service';
import {
  LlmCredential,
  LlmProvider,
  Prisma,
} from '../../generated/prisma/client';
import { ProviderRegistry } from '../llm/providers/provider-registry';
import { CreateLlmCredentialDto } from './dto/create-llm-credential.dto';
import { UpdateLlmCredentialDto } from './dto/update-llm-credential.dto';

/** An undefined field means "header not sent" — Prisma leaves that column unchanged. */
export type RateLimitSnapshot = Partial<
  Pick<
    LlmCredential,
    | 'rlLimitRequests'
    | 'rlRemainingRequests'
    | 'rlResetRequests'
    | 'rlLimitTokens'
    | 'rlRemainingTokens'
    | 'rlResetTokens'
  >
>;

/** Who made a change; written to `audit_logs`. */
export interface CredentialActor {
  id: string;
  email: string;
}

/**
 * What the admin API returns: the credential without the stored key, plus a
 * masked hint. The full key never leaves the server (M6-13).
 */
export type LlmCredentialView = Omit<LlmCredential, 'apiKey'> & {
  maskedKey: string;
};

/** "••••••••abcd"; keys shorter than 12 chars show dots only, so a short key is never mostly revealed. */
export function maskApiKey(apiKey: string): string {
  const tail = apiKey.length >= 12 ? apiKey.slice(-4) : '';
  return `${'•'.repeat(8)}${tail}`;
}

export function toCredentialView(c: LlmCredential): LlmCredentialView {
  const { apiKey, ...rest } = c;
  return { ...rest, maskedKey: maskApiKey(apiKey) };
}

@Injectable()
export class LlmCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly secrets: SecretBox,
  ) {}

  /**
   * The row with its key in plain text, for use inside the server. Keys are
   * stored encrypted (M7-2); a row saved before that is still plain text
   * and is encrypted the next time it is edited.
   */
  private open(row: LlmCredential): LlmCredential {
    return SecretBox.isEncrypted(row.apiKey)
      ? { ...row, apiKey: this.secrets.decrypt(row.apiKey) }
      : row;
  }

  async findAllOrdered(): Promise<LlmCredential[]> {
    const rows = await this.prisma.llmCredential.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((row) => this.open(row));
  }

  /** Only the active ones, in rotation order — what LlmKeyManager actually uses. */
  async findActiveOrdered(): Promise<LlmCredential[]> {
    const all = await this.findAllOrdered();
    return all.filter((c) => c.isActive);
  }

  /**
   * Audit row for a credential change. `details` carries ids, provider,
   * model and flags only — never the key (M6-13).
   */
  private audit(
    actor: CredentialActor,
    action: string,
    details: Prisma.InputJsonObject,
  ): Prisma.AuditLogCreateInput {
    return {
      actor: { connect: { id: actor.id } },
      actorEmail: actor.email,
      action,
      details,
    };
  }

  async create(
    actor: CredentialActor,
    dto: CreateLlmCredentialDto,
  ): Promise<LlmCredential> {
    await this.validateCredential(dto.provider, dto.apiKey, dto.model);
    const { _max } = await this.prisma.llmCredential.aggregate({
      _max: { sortOrder: true },
    });
    const sortOrder = (_max.sortOrder ?? -1) + 1;
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.llmCredential.create({
        data: {
          ...dto,
          apiKey: this.secrets.encrypt(dto.apiKey),
          sortOrder,
        },
      });
      await tx.auditLog.create({
        data: this.audit(actor, 'llm_credential.create', {
          credentialId: created.id,
          provider: created.provider,
          model: created.model,
        }),
      });
      return this.open(created);
    });
  }

  async update(
    actor: CredentialActor,
    id: string,
    dto: UpdateLlmCredentialDto,
  ): Promise<LlmCredential> {
    const credential = await this.findOne(id);
    // Only re-validate when the key or model actually changed — pure
    // isActive toggles and reorders shouldn't burn a real API call.
    if (dto.apiKey !== undefined || dto.model !== undefined) {
      await this.validateCredential(
        dto.provider ?? credential.provider,
        dto.apiKey ?? credential.apiKey,
        dto.model ?? credential.model,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Always written encrypted: this also upgrades a row saved as plain text.
      const updated = await tx.llmCredential.update({
        where: { id },
        data: {
          ...dto,
          apiKey: this.secrets.encrypt(dto.apiKey ?? credential.apiKey),
        },
      });
      await tx.auditLog.create({
        data: this.audit(actor, 'llm_credential.update', {
          credentialId: id,
          provider: updated.provider,
          model: updated.model,
          ...(dto.model !== undefined && { modelFrom: credential.model }),
          keyRotated: dto.apiKey !== undefined,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        }),
      });
      return this.open(updated);
    });
  }

  /**
   * Makes one real (minimal) completion call so a bad API key or a
   * mistyped/deprecated model id ("gemini-2.0-flash" after Google retired
   * it) surfaces immediately on the Settings page instead of only in
   * production logs the next time the chat assistant happens to rotate to
   * this credential.
   */
  private async validateCredential(
    provider: LlmProvider,
    apiKey: string,
    model: string,
  ): Promise<void> {
    const adapter = this.providerRegistry.get(provider);
    try {
      await adapter.complete({
        apiKey,
        model,
        messages: [{ role: 'user', content: 'ping' }],
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Couldn't verify this ${provider} credential — the provider rejected it: ${detail}`,
      );
    }
  }

  async remove(actor: CredentialActor, id: string): Promise<void> {
    const credential = await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.llmCredential.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: this.audit(actor, 'llm_credential.delete', {
          credentialId: id,
          provider: credential.provider,
          model: credential.model,
        }),
      }),
    ]);
  }

  /** Re-numbers sort_order to match the given id order — used by the settings UI's drag/move-up-down reordering. */
  async reorder(
    actor: CredentialActor,
    orderedIds: string[],
  ): Promise<LlmCredential[]> {
    const all = await this.findAllOrdered();
    if (
      orderedIds.length !== all.length ||
      !all.every((c) => orderedIds.includes(c.id))
    ) {
      throw new BadRequestException(
        'orderedIds must contain exactly the existing credential ids',
      );
    }
    await this.prisma.$transaction([
      ...orderedIds.map((id, index) =>
        this.prisma.llmCredential.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
      this.prisma.auditLog.create({
        data: this.audit(actor, 'llm_credential.reorder', { orderedIds }),
      }),
    ]);
    return this.findAllOrdered();
  }

  /**
   * Best-effort — called from LlmKeyManager right after a chat completion
   * call (success or 429) to persist the provider's rate-limit headers
   * for that credential. Never allowed to fail the chat turn: a write
   * error here is logged and swallowed by the caller, not surfaced.
   */
  async recordUsage(id: string, snapshot: RateLimitSnapshot): Promise<void> {
    await this.prisma.llmCredential.update({
      where: { id },
      data: { ...snapshot, lastUsedAt: new Date() },
    });
  }

  private async findOne(id: string): Promise<LlmCredential> {
    const credential = await this.prisma.llmCredential.findUnique({
      where: { id },
    });
    if (!credential) {
      throw new NotFoundException(`LLM credential ${id} not found`);
    }
    return this.open(credential);
  }
}
