import { isAbsolute, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { DailySellerMetricsBackfillError } from '../modules/analytics/application/daily-seller-metrics-backfill.service.js';
import {
  GeFinanceImportError,
  GeFinanceImportResult,
  GeFinanceImportService,
} from '../modules/analytics/application/gefinance-import.service.js';
import { GeFinanceReportError } from '../modules/integrations/gefinance/gefinance-report.provider.js';
import {
  GeFinanceImportFileError,
  sha256GeFinanceFile,
} from './gefinance-import-file.js';

class GeFinanceImportCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeFinanceImportCliError';
  }
}

async function main(): Promise<void> {
  let application;
  try {
    const file = parseFileArgument(process.argv.slice(2));
    const sha256 = await sha256GeFinanceFile(file);
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const result = await application
      .get(GeFinanceImportService)
      .execute({
        file,
        sha256,
        onProgress: (progress) => {
          if (progress.state === 'COMPLETED') {
            process.stdout.write(
              `[${progress.index}/${progress.total}] ${progress.date} ${progress.action}\n`,
            );
          }
        },
      });

    printResult(file, result);
    if (result.backfill.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const knownError =
      error instanceof GeFinanceImportCliError ||
      error instanceof GeFinanceImportFileError ||
      error instanceof GeFinanceImportError ||
      error instanceof GeFinanceReportError ||
      error instanceof DailySellerMetricsBackfillError;
    process.stderr.write(
      `${knownError ? error.message : 'A importação GeFinance não pôde ser iniciada.'}\n`,
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

function usageError(): GeFinanceImportCliError {
  return new GeFinanceImportCliError(
    'Uso: npm run import:gefinance -- --file=<arquivo.xlsx>',
  );
}

function printResult(file: string, result: GeFinanceImportResult): void {
  const { report, marketplaceAccount, olistAccount, backfill } = result;
  process.stdout.write(
    `${[
      'Data | Resultado | Motivo',
      ...backfill.days.map(
        ({ date, action, reason }) => `${date} | ${action} | ${reason ?? '-'}`,
      ),
      '',
      `Arquivo: ${file}`,
      `Conta: ${marketplaceAccount.name} (Marketplace) / ${olistAccount.name.trim()} (Olist)`,
      `integrationKey: ${olistAccount.integrationKey}`,
      `Período detectado: ${report.from} a ${report.to}`,
      `Registros GeFinance: ${report.recordCount}`,
      `Days found: ${backfill.daysFound}`,
      `Skipped: ${backfill.skipped}`,
      `Created: ${backfill.created}`,
      `Updated: ${backfill.updated}`,
      `Failed: ${backfill.failed}`,
      `External processing days: ${backfill.externalProcessingDays}`,
    ].join('\n')}\n`,
  );
}

void main();
