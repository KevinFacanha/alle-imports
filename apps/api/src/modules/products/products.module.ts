import { Module } from '@nestjs/common';

import { DatabaseService } from '../../database/database.service.js';

import { ProductMaterializationService } from './application/product-materialization.service.js';
import { PrismaProductMaterializationStore } from './infrastructure/prisma-product-materialization.store.js';

@Module({
  providers: [
    {
      provide: PrismaProductMaterializationStore,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaProductMaterializationStore(database),
    },
    {
      provide: ProductMaterializationService,
      inject: [PrismaProductMaterializationStore],
      useFactory: (store: PrismaProductMaterializationStore) =>
        new ProductMaterializationService(store),
    },
  ],
  exports: [ProductMaterializationService],
})
export class ProductsModule {}
