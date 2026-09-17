import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import {
  MercadoLivreMetricsReconciliationError,
  MercadoLivreMetricsReconciliationService,
} from '../modules/analytics/application/mercado-livre-metrics-reconciliation.service.js';
import { MercadoLivreClientError } from '../modules/marketplaces/mercado-livre/mercado-livre.client.js';
import { MercadoLivreOAuthError } from '../modules/marketplaces/mercado-livre/oauth/mercado-livre-oauth.types.js';
import { MarketplaceAuthorizationNotFoundError } from '../modules/marketplaces/mercado-livre/oauth/marketplace-authorization.service.js';
import { TokenEncryptionError } from '../modules/marketplaces/mercado-livre/oauth/token-encryption.service.js';

interface CliArguments {
  accountId: string;
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
      .get(MercadoLivreMetricsReconciliationService)
      .reconcile({
        marketplaceAccountId: args.accountId,
        date: args.date,
      });

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    const safeErrors = [
      CliArgumentError,
      MercadoLivreMetricsReconciliationError,
      MercadoLivreClientError,
      MercadoLivreOAuthError,
      MarketplaceAuthorizationNotFoundError,
      TokenEncryptionError,
    ];
    const isSafeError = safeErrors.some(
      (errorType) => error instanceof errorType,
    );
    const message = isSafeError
      ? safeErrorMessage(error as Error)
      : `Mercado Livre metrics reconciliation failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function safeErrorMessage(error: Error): string {
  if (error instanceof MercadoLivreClientError) {
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

  const accountId = values.get('account-id');
  const date = values.get('date');
  if (!accountId || !date || values.size !== 2) {
    throw usageError();
  }
  return { accountId, date };
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run reconcile:ml:metrics -- --account-id=<UUID> --date=YYYY-MM-DD',
  );
}

void main();
