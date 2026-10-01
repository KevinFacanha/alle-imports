import { readFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  ProductMaterializationError,
  ProductMaterializationService,
} from '../modules/products/application/product-materialization.service.js';

interface CliArguments {
  planPath: string;
  dryRun: true;
}

class ProductMaterializationCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMaterializationCliError';
  }
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    const planContents = await readPlan(args.planPath);
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const database = application.get(DatabaseService);
    const databaseCountsBefore = await readDatabaseCounts(database);
    const execution = await application
      .get(ProductMaterializationService)
      .execute({ planContents, dryRun: args.dryRun });
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
        : 'Product materialization dry-run could not be completed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function parseArguments(args: string[]): CliArguments {
  let planPath: string | undefined;
  let dryRun = false;
  for (const argument of args) {
    if (argument === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (argument.startsWith('--plan=') && planPath === undefined) {
      planPath = argument.slice('--plan='.length);
      continue;
    }
    throw usageError();
  }
  if (!planPath || !dryRun || args.length !== 2) throw usageError();
  return { planPath, dryRun: true };
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

function usageError(): ProductMaterializationCliError {
  return new ProductMaterializationCliError(
    'Usage: npm run materialize:products -- --plan=<json> --dry-run',
  );
}

void main();
