import { isAbsolute, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import {
  GeFinanceImportError,
  GeFinanceImportService,
} from '../modules/analytics/application/gefinance-import.service.js';
import { DailySellerMetricsPersistenceError } from '../modules/analytics/application/daily-seller-metrics-persistence.service.js';
import { GeFinanceReportError } from '../modules/integrations/gefinance/gefinance-report.provider.js';

class GeFinanceDailyHashBackfillCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeFinanceDailyHashBackfillCliError';
  }
}

async function main(): Promise<void> {
  let application;
  const startedAt = Date.now();
  try {
    const file = parseFileArgument(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const result = await application
      .get(GeFinanceImportService)
      .backfillDailyHashes({ file });
    const elapsedMs = Date.now() - startedAt;

    process.stdout.write(
      `${[
        `Account: ${result.marketplaceAccount.name}`,
        `Period: ${result.report.from} to ${result.report.to}`,
        `Days found: ${result.backfill.daysFound}`,
        `Snapshots found: ${result.backfill.snapshotsFound}`,
        `Legacy hashes filled: ${result.backfill.hashesFilled}`,
        `Already hashed: ${result.backfill.alreadyHashed}`,
        `Snapshots missing: ${result.backfill.snapshotsMissing}`,
        'External calls: 0',
        `Elapsed ms: ${elapsedMs}`,
      ].join('\n')}\n`,
    );
  } catch (error: unknown) {
    const knownError =
      error instanceof GeFinanceDailyHashBackfillCliError ||
      error instanceof GeFinanceImportError ||
      error instanceof GeFinanceReportError ||
      error instanceof DailySellerMetricsPersistenceError;
    process.stderr.write(
      `${knownError ? error.message : 'O backfill local de hashes não pôde ser executado.'}\n`,
    );
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function parseFileArgument(args: string[]): string {
  if (args.length !== 1 || !args[0]?.startsWith('--file=')) {
    throw usageError();
  }
  const value = args[0].slice('--file='.length).trim();
  if (!value) {
    throw usageError();
  }
  return isAbsolute(value)
    ? value
    : resolve(process.env.INIT_CWD ?? process.cwd(), value);
}

function usageError(): GeFinanceDailyHashBackfillCliError {
  return new GeFinanceDailyHashBackfillCliError(
    'Uso: npm run backfill:gefinance:daily-hashes -- --file=<arquivo.xlsx>',
  );
}

void main();
