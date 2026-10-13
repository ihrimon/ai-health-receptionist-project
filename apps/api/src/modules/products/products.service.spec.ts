import { KNOWLEDGE_LIMITS } from '@brainstack/shared';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { runWithTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA } from '../../tenancy/tenant-prisma';
import { ChatbotService } from '../chatbot/chatbot.service';
import { decodeCursor, encodeCursor } from './product-cursor';
import { ProductsService } from './products.service';

const inTenant = <T>(fn: () => T): T =>
  runWithTenant({ workspaceId: 'ws-1', userId: 'user-1', role: 'ADMIN' }, fn);

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: 'test',
  });

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Product ${n}`,
  price: new Prisma.Decimal('12.5'),
  compareAtPrice: null,
  createdAt: new Date(`2026-10-0${n}T00:00:00Z`),
});

const newProduct = {
  name: 'Shoe',
  stockStatus: 'UNKNOWN' as const,
  attributes: {},
  isActive: true,
};

describe('ProductsService', () => {
  let service: ProductsService;
  let product: {
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let chatbot: { currentId: jest.Mock; defaultCurrency: jest.Mock };

  beforeEach(async () => {
    product = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...data, price: null, compareAtPrice: null }),
      ),
      update: jest.fn().mockResolvedValue(row(1)),
      delete: jest.fn().mockResolvedValue({}),
    };
    chatbot = {
      currentId: jest.fn().mockResolvedValue('bot-1'),
      defaultCurrency: jest.fn().mockResolvedValue('BDT'),
    };
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: TENANT_PRISMA, useValue: { product } },
        { provide: ChatbotService, useValue: chatbot },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  describe('list', () => {
    it('returns a page with a cursor when more rows exist', async () => {
      product.findMany.mockResolvedValue([row(3), row(2), row(1)]);

      const page = await service.list({ limit: 2 });

      expect(page.items.map((p) => p.name)).toEqual(['Product 3', 'Product 2']);
      expect(page.items[0].price).toBe('12.50');
      expect(page.nextCursor).not.toBeNull();
      expect(decodeCursor(page.nextCursor!)).toEqual({
        createdAt: row(2).createdAt,
        id: row(2).id,
      });
      expect(product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('has no cursor on the last page', async () => {
      product.findMany.mockResolvedValue([row(1)]);
      expect((await service.list({ limit: 2 })).nextCursor).toBeNull();
    });

    it('filters by search, category, status and cursor', async () => {
      const cursor = encodeCursor({
        createdAt: row(2).createdAt,
        id: row(2).id,
      });

      await service.list({
        q: 'shoe',
        category: 'Footwear',
        isActive: true,
        cursor,
        limit: 20,
      });

      const [[args]] = product.findMany.mock.calls as [
        [{ where: { AND: object[] } }],
      ];
      expect(args.where.AND).toEqual([
        { chatbotId: 'bot-1' },
        {
          OR: [
            { name: { contains: 'shoe', mode: 'insensitive' } },
            { sku: { contains: 'shoe', mode: 'insensitive' } },
          ],
        },
        { category: { equals: 'Footwear', mode: 'insensitive' } },
        { isActive: true },
        {
          OR: [
            { createdAt: { lt: row(2).createdAt } },
            { createdAt: row(2).createdAt, id: { lt: row(2).id } },
          ],
        },
      ]);
    });

    it('is a 400 for a cursor it did not make', async () => {
      await expect(
        service.list({ cursor: 'not-a-cursor', limit: 20 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it("uses the chatbot's currency when none is given", async () => {
      await inTenant(() => service.create(newProduct));

      expect(product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            workspaceId: 'ws-1',
            chatbotId: 'bot-1',
            ...newProduct,
            currency: 'BDT',
          },
        }),
      );
    });

    it('keeps a currency that is given', async () => {
      await inTenant(() => service.create({ ...newProduct, currency: 'EUR' }));

      expect(chatbot.defaultCurrency).not.toHaveBeenCalled();
      expect(product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'EUR' }) as unknown,
        }),
      );
    });

    it(`stops at ${KNOWLEDGE_LIMITS.products} products`, async () => {
      product.count.mockResolvedValue(KNOWLEDGE_LIMITS.products);

      await expect(inTenant(() => service.create(newProduct))).rejects.toThrow(
        ConflictException,
      );
      expect(product.create).not.toHaveBeenCalled();
    });

    it('is a 409 for a SKU the chatbot already has', async () => {
      product.create.mockRejectedValue(prismaError('P2002'));

      await expect(inTenant(() => service.create(newProduct))).rejects.toThrow(
        'Another product already has this SKU',
      );
    });
  });

  describe('update and remove', () => {
    it('updates only within the chatbot and returns money as strings', async () => {
      const view = await service.update('p-1', { price: '12.50' });

      expect(product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-1', chatbotId: 'bot-1' },
          data: { price: '12.50' },
        }),
      );
      expect(view.price).toBe('12.50');
    });

    it('is a 404 when the product is missing (or another workspace’s)', async () => {
      product.update.mockRejectedValue(prismaError('P2025'));
      product.delete.mockRejectedValue(prismaError('P2025'));

      await expect(service.update('x', { name: 'N' })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('x')).rejects.toThrow(NotFoundException);
    });

    it('is a 409 when an edit takes another product’s SKU', async () => {
      product.update.mockRejectedValue(prismaError('P2002'));

      await expect(service.update('p-1', { sku: 'A-1' })).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
