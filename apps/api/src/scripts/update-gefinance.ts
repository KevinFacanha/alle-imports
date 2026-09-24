import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import {
  GeFinanceImportResult,
  GeFinanceImportService,
} from '../modules/analytics/application/gefinance-import.service.js';
import { sha256GeFinanceFile } from './gefinance-import-file.js';

type AccountLabel = 'C1' | 'C2';
type AccountStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

interface AccountInput {
  label: AccountLabel;
  ordinal: 1 | 2;
  displayFile: string;
  absoluteFile: string;
}

interface AccountOutcome {
  input: AccountInput;
  status: AccountStatus;
  result?: GeFinanceImportResult;
  error?: string;
}

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const inputs: AccountInput[] = ([1, 2] as const).map((ordinal) => {
  const label = `C${ordinal}` as AccountLabel;
  const displayFile = `apps/api/.local-fixtures/gefinance/gefinance-c${ordinal}-latest.xlsx`;
  return {
    label,
    ordinal,
    displayFile,
    absoluteFile: resolve(
      apiRoot,
      '.local-fixtures',
      'gefinance',
      `gefinance-c${ordinal}-latest.xlsx`,
    ),
  };
});

async function main(): Promise<void> {
  const startedAt = Date.now();
  const outcomes = new Map<AccountLabel, AccountOutcome>();
  const available: AccountInput[] = [];

  // Validate both expected inputs before starting either import. Missing files
  // are never replaced by a guessed filename.
  for (const input of inputs) {
    if (await isRegularFile(input.absoluteFile)) {
      available.push(input);
    } else {
      outcomes.set(input.label, {
        input,
        status: 'FAILED',
        error: 'arquivo ausente',
      });
    }
  }

  let application: INestApplicationContext | undefined;
  if (available.length > 0) {
    try {
      application = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
      });
      const importer = application.get(GeFinanceImportService);

      // Deliberately sequential: C1 always completes before C2 starts.
      for (const input of inputs) {
        if (!available.includes(input)) {
          continue;
        }
        outcomes.set(input.label, await importAccount(importer, input));
      }
    } catch {
      for (const input of available) {
        if (!outcomes.has(input.label)) {
          outcomes.set(input.label, {
            input,
            status: 'FAILED',
            error: 'erro estrutural ao iniciar o importador',
          });
        }
      }
    } finally {
      await application?.close();
    }
  }

  for (const input of inputs) {
    printOutcome(outcomes.get(input.label)!);
  }
  printSummary(outcomes, Date.now() - startedAt);

  if ([...outcomes.values()].some(({ status }) => status !== 'SUCCESS')) {
    process.exitCode = 1;
  }
}

async function importAccount(
  importer: GeFinanceImportService,
  input: AccountInput,
): Promise<AccountOutcome> {
  try {
    const sha256 = await sha256GeFinanceFile(input.absoluteFile);
    const result = await importer.execute({
      file: input.absoluteFile,
      sha256,
      expectedAccountOrdinal: input.ordinal,
    });
    return { input, result, status: statusFor(result) };
  } catch (error: unknown) {
    return {
      input,
      status: 'FAILED',
      error: safeErrorLabel(error),
    };
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function statusFor(result: GeFinanceImportResult): AccountStatus {
  if (result.backfill.failed === 0) {
    return 'SUCCESS';
  }
  return result.backfill.failed < result.backfill.daysFound
    ? 'PARTIAL'
    : 'FAILED';
}

function safeErrorLabel(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'falha não identificada no importador';
  }
  const name = /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'Error';
  const code = (error as Error & { code?: unknown }).code;
  const suffix =
    typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? `/${code}` : '';
  return `falha no importador (${name}${suffix})`;
}

function printOutcome(outcome: AccountOutcome): void {
  const backfill = outcome.result?.backfill;
  process.stdout.write(
    `${[
      `=== GEFINANCE ${outcome.input.label} ===`,
      `arquivo: ${outcome.input.displayFile}`,
      `período: ${outcome.result ? `${outcome.result.report.from} a ${outcome.result.report.to}` : '-'}`,
      `skipped: ${backfill?.skipped ?? 0}`,
      `created: ${backfill?.created ?? 0}`,
      `updated: ${backfill?.updated ?? 0}`,
      `failed: ${backfill?.failed ?? (outcome.status === 'FAILED' ? 1 : 0)}`,
      `external processing days: ${backfill?.externalProcessingDays ?? 0}`,
      ...(outcome.error ? [`erro: ${outcome.error}`] : []),
      '',
    ].join('\n')}\n`,
  );
}

function printSummary(
  outcomes: Map<AccountLabel, AccountOutcome>,
  elapsedMs: number,
): void {
  process.stdout.write(
    `${[
      '=== RESUMO ===',
      `C1: ${outcomes.get('C1')!.status}`,
      `C2: ${outcomes.get('C2')!.status}`,
      `Tempo total: ${formatElapsed(elapsedMs)}`,
    ].join('\n')}\n`,
  );
}

function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(3)}s`;
}

void main();
