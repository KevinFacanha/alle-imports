import { readFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  ProductMaterializationError,
  ProductMaterializationService,
} from '../modules/products/application/product-materialization.service.js';

import {
  parseProductMaterializationArguments,
  ProductMaterializationCliError,
} from './materialize-products.arguments.js';

async function main(): Promise<void> {
  let application;
  try {
    const args = parseProductMaterializationArguments(process.argv.slice(2));
    const planContents = await readPlan(args.planPath);
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const database = application.get(DatabaseService);
    const databaseCountsBefore = await readDatabaseCounts(database);
    const execution = await application
      .get(ProductMaterializationService)
      .execute({
        planContents,
        execute: args.execute,
        candidateIds: args.candidateIds,
      });
    const databaseCountsAfter = await readDatabaseCounts(database);
    process.stdout.write(
      `${JSON.stringify({
        execution,
        databaseCountsBefore,
        databaseCountsAfter,
        databaseCountsUnchanged:
          JSON.stringify(databaseCountsBefore) ===
          JSON.stringify(databaseCountsAfter),
      }, null, 2)}\n`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof ProductMaterializationCliError ||
      error instanceof ProductMaterializationError
        ? error.message
        : 'Product materialization could not be completed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

async function readPlan(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    throw new ProductMaterializationCliError(
      `Materialization plan could not be read: ${path}.`,
    );
  }
}

async function readDatabaseCounts(database: DatabaseService): Promise<{
  Product: number;
  ProductExternalIdentity: number;
  MarketplaceListingItemWithProduct: number;
}> {
  const [Product, ProductExternalIdentity, MarketplaceListingItemWithProduct] =
    await Promise.all([
      database.product.count(),
      database.productExternalIdentity.count(),
      database.marketplaceListingItem.count({
        where: { productId: { not: null } },
      }),
    ]);
  return { Product, ProductExternalIdentity, MarketplaceListingItemWithProduct };
}

void main();
