import {
  type CreateProduct,
  createProductSchema,
  KNOWLEDGE_LIMITS,
  type ProductImportResult,
  type ProductListQuery,
  type UpdateProduct,
} from '@brainstack/shared';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
import { KnowledgeIngestQueue } from '../knowledge/knowledge-ingest.queue';
import { limitReached, orNotFound } from '../knowledge-base/knowledge-errors';
import { decodeCursor, encodeCursor } from './product-cursor';
import { csvRowToProduct, parseProductCsv } from './product-csv';

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
    private readonly ingestQueue: KnowledgeIngestQueue,
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
      await this.ingestQueue.enqueue('product', row.id);
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
      // Only name, category and description are embedded.
      if (
        input.name !== undefined ||
        input.category !== undefined ||
        input.description !== undefined
      ) {
        await this.ingestQueue.enqueue('product', id);
      }
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

  /**
   * Imports a product CSV (M2-8): a row whose SKU exists updates that
   * product, any other row creates one. Good rows are saved and bad rows
   * reported by number (lead's call), so a fixed file can be re-uploaded
   * without duplicates.
   */
  async importCsv(file: Buffer): Promise<ProductImportResult> {
    const rows = parseProductCsv(file);
    const chatbotId = await this.chatbot.currentId();
    const skus = rows.map((r) => r.values.sku).filter((s): s is string => !!s);
    const [existing, count, currency] = await Promise.all([
      this.db.product.findMany({
        where: { chatbotId, sku: { in: skus } },
        select: { id: true, sku: true },
      }),
      this.db.product.count({ where: { chatbotId } }),
      this.chatbot.defaultCurrency(),
    ]);
    const idBySku = new Map(existing.map((p) => [p.sku, p.id]));
    const { workspaceId } = requireTenant();

    const result: ProductImportResult = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };
    const fail = (row: number, message: string) => {
      result.failed++;
      result.errors.push({ row, message });
    };
    const seenSkus = new Set<string>();
    const savedIds: string[] = [];
    let total = count;

    // One row at a time, so a failing row doesn't undo the others.
    for (const { row, values } of rows) {
      const parsed = createProductSchema.safeParse(csvRowToProduct(values));
      if (!parsed.success) {
        fail(row, formatIssues(parsed.error.issues));
        continue;
      }
      const product = parsed.data;
      if (product.sku) {
        if (seenSkus.has(product.sku)) {
          fail(row, `SKU ${product.sku} appears earlier in the file`);
          continue;
        }
        seenSkus.add(product.sku);
      }

      const existingId = product.sku ? idBySku.get(product.sku) : undefined;
      try {
        if (existingId) {
          // The CSV has no isActive or attributes columns: keep those.
          const fields: Partial<typeof product> = { ...product };
          delete fields.isActive;
          delete fields.attributes;
          await this.db.product.update({
            where: { id: existingId, chatbotId },
            data: fields,
            select: { id: true },
          });
          savedIds.push(existingId);
          result.updated++;
        } else if (total >= KNOWLEDGE_LIMITS.products) {
          fail(
            row,
            `A chatbot can have at most ${KNOWLEDGE_LIMITS.products} products`,
          );
        } else {
          const created = await this.db.product.create({
            data: {
              workspaceId,
              chatbotId,
              ...product,
              currency: product.currency ?? currency,
            },
            select: { id: true },
          });
          savedIds.push(created.id);
          result.created++;
          total++;
        }
      } catch (err) {
        // A product saved meanwhile took the SKU.
        if (isDuplicateSku(err)) {
          fail(row, `SKU ${product.sku} already exists`);
          continue;
        }
        throw err;
      }
    }
    await this.ingestQueue.enqueueMany('product', savedIds);
    return result;
  }
}

/** "price: Must be an amount…; url: Invalid URL" for a row's report. */
function formatIssues(issues: { path: PropertyKey[]; message: string }[]) {
  return issues
    .map((i) =>
      i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
    )
    .join('; ');
}
