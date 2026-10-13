import {
  type CreateProduct,
  createProductSchema,
  type ProductListQuery,
  productListQuerySchema,
  type UpdateProduct,
  updateProductSchema,
} from '@brainstack/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { ProductsService } from './products.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** D-2 §2.4. CSV import (`/products/import`) arrives with M2-8. */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  list(
    @Query(new ZodBodyPipe(productListQuerySchema)) query: ProductListQuery,
  ) {
    return this.products.list(query);
  }

  @Post()
  @Roles(WorkspaceRole.ADMIN)
  create(@Body(new ZodBodyPipe(createProductSchema)) body: CreateProduct) {
    return this.products.create(body);
  }

  @Patch(':id')
  @Roles(WorkspaceRole.ADMIN)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodBodyPipe(updateProductSchema)) body: UpdateProduct,
  ) {
    return this.products.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(WorkspaceRole.ADMIN)
  remove(@Param('id', uuid) id: string) {
    return this.products.remove(id);
  }
}
