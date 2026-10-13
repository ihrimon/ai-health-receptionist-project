import {
  type CreateProduct,
  KNOWLEDGE_LIMITS,
  type ProductListQuery,
  type UpdateProduct,
} from '@brainstack/shared';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
import { limitReached, orNotFound } from '../knowledge-base/knowledge-errors';
import { decodeCursor, encodeCursor } from './product-cursor';

// The embedding columns (M2-13) and externalId (store sync, P2) stay
// internal.
const PRODUCT_FIELDS = {
  id: true,
  sku: true,
  name: true,
  description: true,
  price: true,
  compareAtPrice: true,
  currency: true,
  stockStatus: true,
  stockQuantity: true,
  category: true,
  url: true,
  imageUrl: true,
  attributes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_FIELDS }>;

/** Money leaves the API as a two-decimal string (D-2 §1). */
function toView(row: ProductRow) {
  return {
    ...row,
    price: row.price?.toFixed(2) ?? null,
    compareAtPrice: row.compareAtPrice?.toFixed(2) ?? null,
  };
}

export type ProductView = ReturnType<typeof toView>;

function isDuplicateSku(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

const duplicateSku = () =>
  new ConflictException('Another product already has this SKU');

/**
 * The chatbot's products (FR-7.4, D-2 §2.4), live on save. CSV import
 * arrives with M2-8; indexing for the bot's search with M2-13.
 */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly chatbot: ChatbotService,
  ) {}

  /** Newest first, `limit` per page; `nextCursor` is null on the last page. */
  async list(query: ProductListQuery) {
    const chatbotId = await this.chatbot.currentId();
    const filters: Prisma.ProductWhereInput[] = [{ chatbotId }];
    if (query.q) {
      filters.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.category) {
      filters.push({
        category: { equals: query.category, mode: 'insensitive' },
      });
    }
    if (query.isActive !== undefined) {
      filters.push({ isActive: query.isActive });
    }
    if (query.cursor) {
      const after = decodeCursor(query.cursor);
      filters.push({
        OR: [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ],
      });
    }

    // One extra row tells whether another page exists.
    const rows = await this.db.product.findMany({
      where: { AND: filters },
      select: PRODUCT_FIELDS,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toView),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async create(input: CreateProduct): Promise<ProductView> {
    const chatbotId = await this.chatbot.currentId();
    // Count-then-insert; see FaqsService.create.
    const count = await this.db.product.count({ where: { chatbotId } });
    if (count >= KNOWLEDGE_LIMITS.products) {
      throw limitReached('products', KNOWLEDGE_LIMITS.products);
    }
    const currency = input.currency ?? (await this.chatbot.defaultCurrency());
    try {
      const row = await this.db.product.create({
        data: {
          workspaceId: requireTenant().workspaceId,
          chatbotId,
          ...input,
          currency,
        },
        select: PRODUCT_FIELDS,
      });
      return toView(row);
    } catch (err) {
      if (isDuplicateSku(err)) throw duplicateSku();
      throw err;
    }
  }

  async update(id: string, input: UpdateProduct): Promise<ProductView> {
    const chatbotId = await this.chatbot.currentId();
    try {
      const row = await orNotFound('Product', () =>
        this.db.product.update({
          where: { id, chatbotId },
          data: input,
          select: PRODUCT_FIELDS,
        }),
      );
      return toView(row);
    } catch (err) {
      if (isDuplicateSku(err)) throw duplicateSku();
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const chatbotId = await this.chatbot.currentId();
    await orNotFound('Product', () =>
      this.db.product.delete({
        where: { id, chatbotId },
        select: { id: true },
      }),
    );
  }
}
