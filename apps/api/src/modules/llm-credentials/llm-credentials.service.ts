import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LlmCredential, LlmProvider } from '../../generated/prisma/client';
import { ProviderRegistry } from '../chat/providers/provider-registry';
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

@Injectable()
export class LlmCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  findAllOrdered(): Promise<LlmCredential[]> {
    return this.prisma.llmCredential.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Only the active ones, in rotation order — what LlmKeyManager actually uses. */
  async findActiveOrdered(): Promise<LlmCredential[]> {
    const all = await this.findAllOrdered();
    return all.filter((c) => c.isActive);
  }

  async create(dto: CreateLlmCredentialDto): Promise<LlmCredential> {
    await this.validateCredential(dto.provider, dto.apiKey, dto.model);
    const { _max } = await this.prisma.llmCredential.aggregate({
      _max: { sortOrder: true },
    });
    return this.prisma.llmCredential.create({
      data: { ...dto, sortOrder: (_max.sortOrder ?? -1) + 1 },
    });
  }

  async update(
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
    return this.prisma.llmCredential.update({ where: { id }, data: dto });
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

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.llmCredential.delete({ where: { id } });
  }

  /** Re-numbers sort_order to match the given id order — used by the settings UI's drag/move-up-down reordering. */
  async reorder(orderedIds: string[]): Promise<LlmCredential[]> {
    const all = await this.findAllOrdered();
    if (
      orderedIds.length !== all.length ||
      !all.every((c) => orderedIds.includes(c.id))
    ) {
      throw new BadRequestException(
        'orderedIds must contain exactly the existing credential ids',
      );
    }
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.llmCredential.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
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
    return credential;
  }
}
