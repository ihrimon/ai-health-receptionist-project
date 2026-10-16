import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import type { ChatCompletionTool } from '../llm/providers/provider-adapter.types';
import {
  KnowledgeService,
  type ProductHit,
} from '../knowledge/knowledge.service';

/** Products the model is shown per search (M3-8). */
const SEARCH_RESULTS = 5;

/**
 * The two tools the model may call about products (M3-8, FR-5.6): prices
 * and stock come from the products table, never from free text. The
 * workspace and chatbot are never arguments: the server adds them.
 */
export const PRODUCT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Search this business’s product catalog. Use it for any question about products, prices, stock, categories or recommendations. Returns up to 5 products.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What the customer is looking for, in a few words.',
          },
          // Optional arguments may be null: many models send null for a
          // filter they don't use, and some providers (Groq) reject the
          // call before it reaches us when the schema doesn't allow it.
          category: {
            type: ['string', 'null'],
            description: 'Only products in this category, or null.',
          },
          max_price: {
            type: ['number', 'null'],
            description:
              'Only products priced at or below this amount, or null.',
          },
          in_stock_only: {
            type: ['boolean', 'null'],
            description: 'Leave out products that are out of stock, or null.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product',
      description:
        'Get the full details of one product by the id returned from search_products.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The product id.' },
        },
        required: ['id'],
      },
    },
  },
];

// null and missing mean the same: no filter.
const searchArgs = z.object({
  query: z.string().trim().max(200).default(''),
  category: z.string().trim().max(100).nullish(),
  max_price: z.number().nonnegative().nullish(),
  in_stock_only: z.boolean().nullish(),
});
const getArgs = z.object({ id: z.uuid() });

export interface ToolRun {
  /** What goes back to the model, as JSON text. */
  content: string;
  /** The products the answer may now rely on. */
  products: ProductHit[];
}

/** The words the model should use; the enum names read badly in an answer. */
const STOCK_TEXT: Record<ProductHit['stockStatus'], string> = {
  IN_STOCK: 'in stock',
  OUT_OF_STOCK: 'out of stock',
  PREORDER: 'available to pre-order',
  UNKNOWN: 'stock level not known',
};

/** The model sees names and numbers as plain text, so format them here. */
function forModel(hit: ProductHit, detailed: boolean) {
  return {
    id: hit.id,
    name: hit.name,
    price:
      hit.price === null
        ? 'not listed (ask the customer to contact the business)'
        : `${hit.price} ${hit.currency}`,
    compare_at_price:
      hit.compareAtPrice === null
        ? undefined
        : `${hit.compareAtPrice} ${hit.currency}`,
    stock: STOCK_TEXT[hit.stockStatus],
    category: hit.category ?? undefined,
    description: hit.description
      ? hit.description.slice(0, detailed ? 1000 : 200)
      : undefined,
    url: hit.url ?? undefined,
    ...(detailed ? { attributes: hit.attributes } : {}),
  };
}

/**
 * Runs the product tools for one chatbot (M3-8). Must run in that
 * workspace's tenant context.
 */
@Injectable()
export class ProductToolsService {
  constructor(
    private readonly knowledge: KnowledgeService,
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
  ) {}

  /** Tools are only offered to the model when there is something to find. */
  async hasProducts(chatbotId: string): Promise<boolean> {
    const count = await this.db.product.count({
      where: { chatbotId, isActive: true },
    });
    return count > 0;
  }

  async run(
    chatbotId: string,
    name: string,
    rawArgs: string,
  ): Promise<ToolRun> {
    let args: unknown;
    try {
      args = JSON.parse(rawArgs || '{}');
    } catch {
      return failure('The arguments were not valid JSON.');
    }

    if (name === 'search_products') {
      const parsed = searchArgs.safeParse(args);
      if (!parsed.success)
        return failure('Invalid arguments for search_products.');
      const hits = await this.knowledge.searchProducts(
        chatbotId,
        {
          query: parsed.data.query,
          category: parsed.data.category ?? undefined,
          maxPrice: parsed.data.max_price ?? undefined,
          inStockOnly: parsed.data.in_stock_only ?? undefined,
        },
        SEARCH_RESULTS,
      );
      return {
        content: JSON.stringify({
          count: hits.length,
          products: hits.map((hit) => forModel(hit, false)),
          ...(hits.length === 0
            ? {
                note: 'No matching products. Do not guess; say you could not find it.',
              }
            : {}),
        }),
        products: hits,
      };
    }

    if (name === 'get_product') {
      const parsed = getArgs.safeParse(args);
      if (!parsed.success) return failure('Invalid arguments for get_product.');
      const hit = await this.knowledge.getProduct(chatbotId, parsed.data.id);
      if (!hit) {
        return {
          content: JSON.stringify({ error: 'No product with that id.' }),
          products: [],
        };
      }
      return {
        content: JSON.stringify({ product: forModel(hit, true) }),
        products: [hit],
      };
    }

    return failure(`Unknown tool: ${name}`);
  }
}

function failure(message: string): ToolRun {
  return { content: JSON.stringify({ error: message }), products: [] };
}
