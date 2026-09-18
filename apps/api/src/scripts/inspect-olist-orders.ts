import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import {
  OlistAuthorizationNotFoundError,
  OlistReauthorizationRequiredError,
} from '../modules/integrations/olist/olist-authorization.service.js';
import {
  OlistOrdersClientError,
} from '../modules/integrations/olist/olist-orders.client.js';
import {
  OlistOrdersInspectionError,
  OlistOrdersInspectionService,
} from '../modules/integrations/olist/olist-orders-inspection.service.js';
import { TokenEncryptionError } from '../modules/integrations/oauth/token-encryption.service.js';

interface CliArguments {
  olistAccountId: string;
  marketplaceAccountId: string;
  date: string;
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const report = await application
      .get(OlistOrdersInspectionService)
      .inspect({
        olistAccountId: args.olistAccountId,
        marketplaceAccountId: args.marketplaceAccountId,
        date: args.date,
      });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    const safe =
      error instanceof CliArgumentError ||
      error instanceof OlistOrdersInspectionError ||
      error instanceof OlistOrdersClientError ||
      error instanceof OlistAuthorizationNotFoundError ||
      error instanceof OlistReauthorizationRequiredError ||
      error instanceof TokenEncryptionError;
    const message = safe
      ? formatSafeError(error as Error)
      : `Olist orders inspection failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function formatSafeError(error: Error): string {
  if (error instanceof OlistOrdersClientError) {
    const status = error.statusCode ? `, HTTP ${error.statusCode}` : '';
    return `${error.message} (${error.code}${status})`;
  }
  return error.message;
}

function errorName(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `${error.name}:${error.code}`;
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
    const name = argument.slice(2, separator);
    if (values.has(name)) {
      throw usageError();
    }
    values.set(name, argument.slice(separator + 1));
  }
  const olistAccountId = values.get('olist-account-id');
  const marketplaceAccountId = values.get('marketplace-account-id');
  const date = values.get('date');
  if (!olistAccountId || !marketplaceAccountId || !date || values.size !== 3) {
    throw usageError();
  }
  return { olistAccountId, marketplaceAccountId, date };
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run inspect:olist:orders -- --olist-account-id=<UUID> --marketplace-account-id=<UUID> --date=YYYY-MM-DD',
  );
}

void main();
