import { Test } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import {
  KnowledgeService,
  type ProductHit,
} from '../knowledge/knowledge.service';
import { PRODUCT_TOOLS, ProductToolsService } from './product-tools.service';

const shoe: ProductHit = {
  id: '5b0d3c1e-7a5c-4b88-9f0a-0a6f2f7d9a11',
  name: 'Trail shoe',
  description: 'Light shoe for trails.',
  price: '49.90',
  compareAtPrice: '59.00',
  currency: 'USD',
  stockStatus: 'IN_STOCK',
  category: 'Shoes',
  url: 'https://shop.example.com/trail',
  attributes: { size: ['40', '41'] },
};

describe('ProductToolsService', () => {
  const knowledge = { searchProducts: jest.fn(), getProduct: jest.fn() };
  const db = { product: { count: jest.fn() } };
  let service: ProductToolsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductToolsService,
        { provide: KnowledgeService, useValue: knowledge },
        { provide: TENANT_PRISMA, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(ProductToolsService);
  });

  it('never lets the model choose the workspace or chatbot', () => {
    for (const tool of PRODUCT_TOOLS) {
      const names = Object.keys(
        (tool.function!.parameters as { properties: object }).properties,
      );
      expect(names).not.toContain('workspace_id');
      expect(names).not.toContain('workspaceId');
      expect(names).not.toContain('chatbot_id');
      expect(names).not.toContain('chatbotId');
    }
    expect(PRODUCT_TOOLS.map((t) => t.function!.name)).toEqual([
      'search_products',
      'get_product',
    ]);
  });

  it('offers the tools only to a chatbot with active products', async () => {
    db.product.count.mockResolvedValue(0);
    await expect(service.hasProducts('bot-1')).resolves.toBe(false);
    expect(db.product.count).toHaveBeenCalledWith({
      where: { chatbotId: 'bot-1', isActive: true },
    });
    db.product.count.mockResolvedValue(3);
    await expect(service.hasProducts('bot-1')).resolves.toBe(true);
  });

  it('searches with the chatbot from the server and returns exact money as text', async () => {
    knowledge.searchProducts.mockResolvedValue([shoe]);

    const run = await service.run(
      'bot-1',
      'search_products',
      JSON.stringify({ query: 'shoe', max_price: 60, in_stock_only: true }),
    );

    expect(knowledge.searchProducts).toHaveBeenCalledWith(
      'bot-1',
      {
        query: 'shoe',
        category: undefined,
        maxPrice: 60,
        inStockOnly: true,
      },
      5,
    );
    expect(run.products).toEqual([shoe]);
    expect(JSON.parse(run.content)).toEqual({
      count: 1,
      products: [
        {
          id: shoe.id,
          name: 'Trail shoe',
          price: '49.90 USD',
          compare_at_price: '59.00 USD',
          stock: 'in stock',
          category: 'Shoes',
          description: 'Light shoe for trails.',
          url: 'https://shop.example.com/trail',
        },
      ],
    });
  });

  it('treats a null filter like a missing one', async () => {
    knowledge.searchProducts.mockResolvedValue([shoe]);

    await service.run(
      'bot-1',
      'search_products',
      JSON.stringify({
        query: 'shoe',
        category: null,
        max_price: null,
        in_stock_only: null,
      }),
    );

    expect(knowledge.searchProducts).toHaveBeenCalledWith(
      'bot-1',
      {
        query: 'shoe',
        category: undefined,
        maxPrice: undefined,
        inStockOnly: undefined,
      },
      5,
    );
  });

  it('lets the model send null for every optional filter', () => {
    const search = PRODUCT_TOOLS.find(
      (t) => t.function!.name === 'search_products',
    )!;
    const properties = (
      search.function!.parameters as {
        properties: Record<string, { type: unknown }>;
        required: string[];
      }
    ).properties;
    for (const name of ['category', 'max_price', 'in_stock_only']) {
      expect(properties[name].type).toEqual([expect.any(String), 'null']);
    }
    expect(
      (search.function!.parameters as { required: string[] }).required,
    ).toEqual(['query']);
  });

  it('says plainly when nothing was found', async () => {
    knowledge.searchProducts.mockResolvedValue([]);
    const run = await service.run(
      'bot-1',
      'search_products',
      JSON.stringify({ query: 'unicorn' }),
    );
    expect(run.products).toEqual([]);
    expect(JSON.parse(run.content)).toMatchObject({
      count: 0,
      note: expect.stringContaining('Do not guess') as string,
    });
  });

  it('shows an unlisted price as not listed, never as zero', async () => {
    knowledge.searchProducts.mockResolvedValue([{ ...shoe, price: null }]);
    const run = await service.run(
      'bot-1',
      'search_products',
      JSON.stringify({ query: 'shoe' }),
    );
    const price = (JSON.parse(run.content) as { products: { price: string }[] })
      .products[0].price;
    expect(price).toMatch(/not listed/);
  });

  it('says stock in words, never as an enum name', async () => {
    knowledge.searchProducts.mockResolvedValue([
      { ...shoe, stockStatus: 'OUT_OF_STOCK' },
      { ...shoe, id: 'p2', stockStatus: 'PREORDER' },
      { ...shoe, id: 'p3', stockStatus: 'UNKNOWN' },
    ]);
    const run = await service.run(
      'bot-1',
      'search_products',
      JSON.stringify({ query: 'shoe' }),
    );
    expect(
      (
        JSON.parse(run.content) as { products: { stock: string }[] }
      ).products.map((p) => p.stock),
    ).toEqual([
      'out of stock',
      'available to pre-order',
      'stock level not known',
    ]);
    expect(run.content).not.toMatch(/OUT_OF_STOCK|PREORDER|UNKNOWN/);
  });

  it('gets one product with its attributes', async () => {
    knowledge.getProduct.mockResolvedValue(shoe);
    const run = await service.run(
      'bot-1',
      'get_product',
      JSON.stringify({ id: shoe.id }),
    );
    expect(knowledge.getProduct).toHaveBeenCalledWith('bot-1', shoe.id);
    expect(JSON.parse(run.content)).toMatchObject({
      product: { name: 'Trail shoe', attributes: { size: ['40', '41'] } },
    });
  });

  it('reports a product that is not this chatbot’s as not found', async () => {
    knowledge.getProduct.mockResolvedValue(null);
    const run = await service.run(
      'bot-1',
      'get_product',
      JSON.stringify({ id: shoe.id }),
    );
    expect(run.products).toEqual([]);
    expect(JSON.parse(run.content)).toEqual({
      error: 'No product with that id.',
    });
  });

  it.each([
    ['search_products', '{"query":'],
    ['search_products', JSON.stringify({ query: 5 })],
    ['get_product', JSON.stringify({ id: 'not-a-uuid' })],
    ['delete_everything', '{}'],
  ])(
    'answers %s with a bad call (%s) as an error, not a crash',
    async (name, args) => {
      const run = await service.run('bot-1', name, args);
      expect(run.products).toEqual([]);
      expect(JSON.parse(run.content)).toHaveProperty('error');
      expect(knowledge.searchProducts).not.toHaveBeenCalled();
      expect(knowledge.getProduct).not.toHaveBeenCalled();
    },
  );
});
