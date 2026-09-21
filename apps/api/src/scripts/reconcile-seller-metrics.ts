import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import { SellerMetricsReconciliationService } from '../modules/analytics/application/seller-metrics-reconciliation.service.js';
import { GeFinanceReportError } from '../modules/integrations/gefinance/gefinance-report.provider.js';
import { OlistOAuthError } from '../modules/integrations/olist/olist-oauth.types.js';
import { OlistOrdersClientError } from '../modules/integrations/olist/olist-orders.client.js';
import { OlistOrdersInspectionError } from '../modules/integrations/olist/olist-orders-inspection.service.js';
import { TokenEncryptionError } from '../modules/integrations/oauth/token-encryption.service.js';
import { MercadoLivreClientError } from '../modules/marketplaces/mercado-livre/mercado-livre.client.js';
import { MercadoLivreOAuthError } from '../modules/marketplaces/mercado-livre/oauth/mercado-livre-oauth.types.js';
import { MarketplaceAuthorizationNotFoundError } from '../modules/marketplaces/mercado-livre/oauth/marketplace-authorization.service.js';

interface CliArguments {
  marketplaceAccountId: string;
  olistAccountId: string;
  geFinanceReportPath: string;
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
      .get(SellerMetricsReconciliationService)
      .reconcile(args);

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    const safeErrors = [
      CliArgumentError,
      GeFinanceReportError,
      OlistOrdersInspectionError,
      OlistOrdersClientError,
      OlistOAuthError,
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
      : `Seller metrics reconciliation failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
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

  const marketplaceAccountId = values.get('marketplace-account-id');
  const olistAccountId = values.get('olist-account-id');
  const geFinanceReportPath = values.get('gefinance-file');
  const date = values.get('date');
  if (
    !marketplaceAccountId ||
    !olistAccountId ||
    !geFinanceReportPath ||
    !date ||
    values.size !== 4
  ) {
    throw usageError();
  }
  return {
    marketplaceAccountId,
    olistAccountId,
    geFinanceReportPath,
    date,
  };
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run reconcile:seller-metrics -- --marketplace-account-id=<UUID> --olist-account-id=<UUID> --gefinance-file=<xlsx> --date=YYYY-MM-DD',
  );
}

void main();
