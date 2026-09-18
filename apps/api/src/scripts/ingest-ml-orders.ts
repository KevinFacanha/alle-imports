import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import {
  OrdersIngestionError,
  OrdersIngestionService,
} from '../modules/marketplaces/application/orders-ingestion.service.js';
import { MercadoLivreClientError } from '../modules/marketplaces/mercado-livre/mercado-livre.client.js';
import { MercadoLivreOAuthError } from '../modules/marketplaces/mercado-livre/oauth/mercado-livre-oauth.types.js';
import { MarketplaceAuthorizationNotFoundError } from '../modules/marketplaces/mercado-livre/oauth/marketplace-authorization.service.js';
import { TokenEncryptionError } from '../modules/integrations/oauth/token-encryption.service.js';

interface CliArguments {
  accountId: string;
  dateFrom: Date;
  dateTo: Date;
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const summary = await application
      .get(OrdersIngestionService)
      .ingest({
        marketplaceAccountId: args.accountId,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
      });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error: unknown) {
    const safeErrors = [
      CliArgumentError,
      OrdersIngestionError,
      MercadoLivreClientError,
      MercadoLivreOAuthError,
      MarketplaceAuthorizationNotFoundError,
      TokenEncryptionError,
    ];
    const isSafeError = safeErrors.some(
      (errorType) => error instanceof errorType,
    );
    const message = isSafeError
      ? (error as Error).message
      : `Mercado Livre orders ingestion failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function errorName(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const databaseCode = error.meta?.code;
    const safeDatabaseCode =
      typeof databaseCode === 'string' && /^[A-Za-z0-9_-]+$/.test(databaseCode)
        ? `:${databaseCode}`
        : '';
    return `${error.name}:${error.code}${safeDatabaseCode}`;
  }
  return error instanceof Error && /^[A-Za-z]+$/.test(error.name)
    ? error.name
    : 'UnknownError';
}

class CliArgumentError extends Error {}

function parseArguments(args: string[]): CliArguments {
  const values = new Map<string, string>();
  for (const argument of args) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) {
      throw usageError();
    }
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }

  const accountId = values.get('account-id');
  const from = values.get('from');
  const to = values.get('to');
  if (!accountId || !from || !to || values.size !== 3) {
    throw usageError();
  }

  const dateFrom = parseIsoDate(from, '--from');
  const dateTo = parseIsoDate(to, '--to');
  if (dateFrom >= dateTo) {
    throw new CliArgumentError('--from must be before --to.');
  }

  return { accountId, dateFrom, dateTo };
}

function parseIsoDate(value: string, name: string): Date {
  const isoDateTime =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  const match = isoDateTime.exec(value);
  const date = new Date(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    !match ||
    Number.isNaN(date.getTime()) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth
  ) {
    throw new CliArgumentError(`${name} must be a valid ISO date-time.`);
  }
  return date;
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run ingest:ml:orders -- --account-id=<UUID> --from=<ISO> --to=<ISO>',
  );
}

void main();
