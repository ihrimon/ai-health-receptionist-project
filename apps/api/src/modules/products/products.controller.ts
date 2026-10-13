import {
  type CreateProduct,
  createProductSchema,
  type ProductListQuery,
  productListQuerySchema,
  type UpdateProduct,
  updateProductSchema,
} from '@brainstack/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { WorkspaceRole } from '../../generated/prisma/client';
import { Roles } from '../../tenancy/workspace.guard';
import { PRODUCT_CSV_MAX_BYTES, productCsvTemplate } from './product-csv';
import { ProductsService } from './products.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** D-2 §2.4. */
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

  /**
   * CSV import (M2-8): runs in this request, since a file holds at most
   * 200 rows (lead's call; D-2 planned a background job for 5,000).
   * A file over 1 MB is a 413.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_CSV_MAX_BYTES, files: 1 },
    }),
  )
  importCsv(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('Attach the CSV as the "file" field');
    }
    return this.products.importCsv(file.buffer);
  }

  @Get('import/template.csv')
  @Roles(WorkspaceRole.VIEWER)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products-template.csv"')
  template(): string {
    return productCsvTemplate();
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
