import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
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
    const sha256 = await sha256File(file);
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

async function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', () => {
      reject(
        new GeFinanceImportCliError(
          'O arquivo GeFinance não pôde ser aberto para leitura.',
        ),
      );
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
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
