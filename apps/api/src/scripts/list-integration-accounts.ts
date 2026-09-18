import { NestFactory } from '@nestjs/core';
import { Marketplace } from '@prisma/client';

import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';

async function main(): Promise<void> {
  let application;
  try {
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const database = application.get(DatabaseService);
    const [marketplaceAccounts, olistAccounts] = await Promise.all([
      database.marketplaceAccount.findMany({
        where: { marketplace: Marketplace.MERCADO_LIVRE },
        select: {
          id: true,
          name: true,
          externalAccountId: true,
          active: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      database.olistAccount.findMany({
        select: { id: true, name: true, active: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    process.stdout.write(
      `${JSON.stringify(
        {
          diagnostic: 'READ_ONLY',
          marketplaceAccounts: marketplaceAccounts.map((account) => ({
            id: account.id,
            name: account.name,
            sellerId: account.externalAccountId,
            active: account.active,
          })),
          // Olist externalAccountId can be a CPF/CNPJ and is intentionally omitted.
          olistAccounts,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(`Account inventory failed (${name}).\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

void main();
