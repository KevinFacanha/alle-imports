import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  DailySellerMetricsPersistenceError,
  DailySellerMetricsPersistenceService,
  PERSISTED_SELLER_METRIC_NAMES,
} from '../modules/analytics/application/daily-seller-metrics-persistence.service.js';
import { SellerBiMetricResolver } from '../modules/analytics/application/seller-bi-metric.resolver.js';
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
    const reconciliation = await application
      .get(SellerMetricsReconciliationService)
      .reconcile(args);
    const resolved = application
      .get(SellerBiMetricResolver)
      .resolve(reconciliation);
    const geFinanceReportSha256 = await sha256File(
      args.geFinanceReportPath,
    );
    const database = application.get(DatabaseService);
    await database.$disconnect();
    await database.$connect();
    const persistence = await application
      .get(DailySellerMetricsPersistenceService)
      .persist(resolved, {
        marketplaceAccountId: args.marketplaceAccountId,
        geFinanceReportSha256,
      });

    const metrics = Object.fromEntries(
      PERSISTED_SELLER_METRIC_NAMES.map((name) => {
        const metric = resolved.metrics[name];
        return [
          name,
          {
            value: metric.value,
            source: metric.source,
            status: metric.status,
            confidence: metric.confidence,
            validationEvidenceCount: metric.validationEvidence.length,
          },
        ];
      }),
    );
    process.stdout.write(
      `${JSON.stringify({ persistence, metrics }, null, 2)}\n`,
    );
  } catch (error: unknown) {
    const safeErrors = [
      CliArgumentError,
      DailySellerMetricsPersistenceError,
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
      : `Seller metrics persistence failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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
    if (values.has(name)) throw usageError();
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
    'Usage: npm run persist:seller-metrics -- --marketplace-account-id=<UUID> --olist-account-id=<UUID> --gefinance-file=<xlsx> --date=YYYY-MM-DD',
  );
}

void main();
