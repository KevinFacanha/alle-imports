import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { MarketplaceOrderSyncService } from '../modules/marketplaces/application/marketplace-order-sync.service.js';

async function main(): Promise<void> {
  let application;
  try {
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const sync = application.get(MarketplaceOrderSyncService);
    const result = await sync.runIncremental();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    const name =
      error instanceof Error && /^[A-Za-z]+$/.test(error.name)
        ? error.name
        : 'UnknownError';
    process.stderr.write(`Incremental Mercado Livre order sync failed (${name}).\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

void main();
