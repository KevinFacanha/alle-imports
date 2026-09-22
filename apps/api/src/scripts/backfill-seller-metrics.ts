import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import {
  DailySellerMetricsBackfillError,
  DailySellerMetricsBackfillService,
  DailySellerMetricsBackfillSummary,
} from '../modules/analytics/application/daily-seller-metrics-backfill.service.js';

interface CliArguments {
  marketplaceAccountId: string;
  olistAccountId: string;
  geFinanceReportPath: string;
  from: string;
  to: string;
}

class BackfillCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillCliError';
  }
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    const geFinanceReportSha256 = await sha256File(args.geFinanceReportPath);
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const summary = await application
      .get(DailySellerMetricsBackfillService)
      .execute({
        ...args,
        geFinanceReportSha256,
      });

    printSummary(summary);
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message =
      error instanceof BackfillCliError ||
      error instanceof DailySellerMetricsBackfillError
        ? error.message
        : 'Seller metrics backfill could not be started.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function printSummary(summary: DailySellerMetricsBackfillSummary): void {
  const table = [
    'date | status | created/updated/failed | motivo',
    ...summary.days.map(
      (day) =>
        `${day.date} | ${day.status} | ${day.action} | ${day.reason ?? '-'}`,
    ),
  ];
  const finalSummary = {
    daysProcessed: summary.daysProcessed,
    created: summary.created,
    updated: summary.updated,
    failed: summary.failed,
    snapshots: summary.snapshots,
    elapsedMs: summary.elapsedMs,
  };
  process.stdout.write(`${table.join('\n')}\n`);
  process.stdout.write(`${JSON.stringify(finalSummary, null, 2)}\n`);
}

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
  const from = values.get('from');
  const to = values.get('to');
  if (
    !marketplaceAccountId ||
    !olistAccountId ||
    !geFinanceReportPath ||
    !from ||
    !to ||
    values.size !== 5
  ) {
    throw usageError();
  }
  return {
    marketplaceAccountId,
    olistAccountId,
    geFinanceReportPath,
    from,
    to,
  };
}

function usageError(): BackfillCliError {
  return new BackfillCliError(
    'Usage: npm run backfill:seller-metrics -- --marketplace-account-id=<UUID> --olist-account-id=<UUID> --gefinance-file=<xlsx> --from=YYYY-MM-DD --to=YYYY-MM-DD',
  );
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', () => {
      reject(
        new BackfillCliError(
          'The GeFinance XLSX could not be opened for SHA-256 calculation.',
        ),
      );
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

void main();
