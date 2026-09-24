import { open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import {
  GeFinanceImportPreflight,
  GeFinanceImportResult,
  GeFinanceImportService,
} from '../modules/analytics/application/gefinance-import.service.js';
import { DailySellerMetricsBackfillProgress } from '../modules/analytics/application/daily-seller-metrics-backfill.service.js';
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
const lockPath = resolve(
  apiRoot,
  '.local-fixtures',
  'gefinance',
  '.update-gefinance.lock',
);
const startedAt = Number(process.env.GEFINANCE_UPDATE_STARTED_AT) || Date.now();
const preflightOnly = process.argv.includes('--preflight-only');
const includeToday = process.argv.includes('--include-today');
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
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireUpdateLock();
  } catch (error: unknown) {
    log(safeErrorLabel(error));
    process.exitCode = 1;
    return;
  }

  try {
    await runUpdate();
  } finally {
    await releaseLock();
  }
}

async function runUpdate(): Promise<void> {
  const outcomes = new Map<AccountLabel, AccountOutcome>();
  const available: AccountInput[] = [];
  const preflights = new Map<AccountLabel, GeFinanceImportPreflight>();

  for (const input of inputs) {
    if (await isRegularFile(input.absoluteFile)) {
      available.push(input);
    } else {
      outcomes.set(input.label, {
        input,
        status: 'FAILED',
        error: 'arquivo ausente',
      });
      log(`${input.label}: arquivo ausente`);
    }
  }

  let application: INestApplicationContext | undefined;
  if (available.length > 0) {
    try {
      log('Inicializando contexto local');
      application = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
      });
      const importer = application.get(GeFinanceImportService);

      // Both accounts complete local inspection and snapshot comparison before
      // the first Mercado Livre/Olist request is allowed to start.
      for (const input of inputs) {
        if (!available.includes(input)) {
          continue;
        }
        try {
          log(`${input.label}: identificando conta, período e businessDates`);
          log(`${input.label}: calculando hashes diários`);
          const sha256 = await sha256GeFinanceFile(input.absoluteFile);
          const preflight = await importer.preflight({
            file: input.absoluteFile,
            sha256,
            expectedAccountOrdinal: input.ordinal,
            includeToday,
          });
          preflights.set(input.label, preflight);
          log(
            `${input.label} identificada — ${preflight.marketplaceAccount.name} / Olist ${preflight.olistAccount.integrationKey}`,
          );
          log(
            `${input.label}: ${preflight.plan.skipped} SKIPPED / ${preflight.plan.localRefreshDays} LOCAL / ${preflight.plan.externalProcessingDays} EXTERNAL / ${preflight.plan.currentDayIgnored} TODAY IGNORED`,
          );
          printPreflight(input, preflight);
        } catch (error: unknown) {
          outcomes.set(input.label, {
            input,
            status: 'FAILED',
            error: safeErrorLabel(error),
          });
          log(`${input.label}: preflight falhou — ${safeErrorLabel(error)}`);
        }
      }

      printPreflightSummary(preflights);
      const externalDays = [...preflights.values()].reduce(
        (total, preflight) => total + preflight.plan.externalProcessingDays,
        0,
      );
      log(
        `Preflight local concluído — ${externalDays} dia(s) exigem APIs externas`,
      );

      if (!preflightOnly) {
        log('Iniciando chamadas externas');
        // Deliberately sequential: C1 always completes before C2 starts.
        for (const input of inputs) {
          const preflight = preflights.get(input.label);
          if (!preflight) {
            continue;
          }
          outcomes.set(
            input.label,
            await importPreparedAccount(importer, input, preflight),
          );
        }
      } else {
        log('Modo preflight-only: nenhuma chamada externa foi iniciada');
      }
    } catch (error: unknown) {
      for (const input of available) {
        if (!outcomes.has(input.label) && !preflights.has(input.label)) {
          outcomes.set(input.label, {
            input,
            status: 'FAILED',
            error: safeErrorLabel(error),
          });
        }
      }
    } finally {
      await application?.close();
    }
  }

  if (preflightOnly) {
    if ([...outcomes.values()].some(({ status }) => status === 'FAILED')) {
      process.exitCode = 1;
    }
    log(`Preflight finalizado em ${formatElapsed(Date.now() - startedAt)}`);
    return;
  }

  for (const input of inputs) {
    printOutcome(
      outcomes.get(input.label) ?? {
        input,
        status: 'FAILED',
        error: 'resultado ausente',
      },
    );
  }
  printSummary(outcomes, Date.now() - startedAt);

  if ([...outcomes.values()].some(({ status }) => status !== 'SUCCESS')) {
    process.exitCode = 1;
  }
}

async function importPreparedAccount(
  importer: GeFinanceImportService,
  input: AccountInput,
  preflight: GeFinanceImportPreflight,
): Promise<AccountOutcome> {
  const progress = createProgressReporter(input.label);
  try {
    const result = await importer.executePrepared(preflight, progress.report);
    return { input, result, status: statusFor(result) };
  } catch (error: unknown) {
    return {
      input,
      status: 'FAILED',
      error: safeErrorLabel(error),
    };
  } finally {
    progress.stop();
  }
}

function createProgressReporter(label: AccountLabel): {
  report: (progress: DailySellerMetricsBackfillProgress) => void;
  stop: () => void;
} {
  let heartbeat: NodeJS.Timeout | undefined;
  let heartbeatCount = 0;
  let activeDate = '';

  const stop = (): void => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };

  const report = (progress: DailySellerMetricsBackfillProgress): void => {
    if (progress.state === 'PROCESSING') {
      stop();
      activeDate = displayDate(progress.date);
      if (progress.processing === 'LOCAL') {
        log(
          `${label} ${activeDate} — refresh local GeFinance (${progress.index}/${progress.total})`,
        );
        return;
      }
      heartbeatCount = 0;
      log(
        `${label} ${activeDate} — iniciando processamento externo (${progress.index}/${progress.total})`,
      );
      heartbeat = setInterval(() => {
        heartbeatCount += 1;
        log(
          heartbeatCount % 2 === 1
            ? `${label} ${activeDate} — aguardando Olist (paginação/detalhes)`
            : `${label} ${activeDate} — ainda processando, sem erro`,
        );
      }, 30_000);
      return;
    }

    if (progress.action !== 'SKIPPED') {
      stop();
      log(`${label} ${displayDate(progress.date)} — ${progress.action}`);
    }
  };

  return { report, stop };
}

async function acquireUpdateLock(): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        'utf8',
      );
      return async () => {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error: unknown) {
      if (!isFileExistsError(error)) {
        throw error;
      }
      const ownerPid = await readLockPid();
      if (ownerPid !== null && processIsRunning(ownerPid)) {
        throw new GeFinanceUpdateLockError(
          `Outra atualização GeFinance já está em execução (PID ${ownerPid}).`,
        );
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new GeFinanceUpdateLockError(
    'Não foi possível adquirir o lock da atualização GeFinance.',
  );
}

async function readLockPid(): Promise<number | null> {
  try {
    const value = JSON.parse(await readFile(lockPath, 'utf8')) as {
      pid?: unknown;
    };
    return Number.isInteger(value.pid) && Number(value.pid) > 0
      ? Number(value.pid)
      : null;
  } catch {
    return null;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isFileExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

class GeFinanceUpdateLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeFinanceUpdateLockError';
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
  if (error instanceof GeFinanceUpdateLockError) {
    return error.message;
  }
  const name = /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'Error';
  const code = (error as Error & { code?: unknown }).code;
  const suffix =
    typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? `/${code}` : '';
  return `falha no importador (${name}${suffix})`;
}

function printPreflight(
  input: AccountInput,
  preflight: GeFinanceImportPreflight,
): void {
  process.stdout.write(
    `${[
      input.label,
      `${preflight.plan.daysFound} businessDates no XLSX`,
      `${preflight.plan.skipped} SKIPPED`,
      `${preflight.plan.localRefreshDays} GEFINANCE_LOCAL_REFRESH`,
      `${preflight.plan.externalProcessingDays} FULL_EXTERNAL_PROCESS`,
      `${preflight.plan.currentDayIgnored} CURRENT_DAY_IGNORED`,
      '',
    ].join('\n')}\n`,
  );
}

function printPreflightSummary(
  preflights: Map<AccountLabel, GeFinanceImportPreflight>,
): void {
  const total = (field: 'skipped' | 'localRefreshDays' | 'externalProcessingDays' | 'currentDayIgnored'): number =>
    [...preflights.values()].reduce(
      (sum, preflight) => sum + preflight.plan[field],
      0,
    );
  process.stdout.write(
    `${[
      'Resumo:',
      `SKIPPED: ${total('skipped')}`,
      `LOCAL_REFRESH: ${total('localRefreshDays')}`,
      `EXTERNAL_PROCESS: ${total('externalProcessingDays')}`,
      `CURRENT_DAY_IGNORED: ${total('currentDayIgnored')}`,
      '',
    ].join('\n')}\n`,
  );
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
      `local refresh days: ${backfill?.localRefreshDays ?? 0}`,
      `external processing days: ${backfill?.externalProcessingDays ?? 0}`,
      `current day ignored: ${backfill?.currentDayIgnored ?? 0}`,
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
      `C1: ${outcomes.get('C1')?.status ?? 'FAILED'}`,
      `C2: ${outcomes.get('C2')?.status ?? 'FAILED'}`,
      `Tempo total: ${formatElapsed(elapsedMs)}`,
    ].join('\n')}\n`,
  );
}

function log(message: string): void {
  process.stdout.write(`[${formatClock(Date.now() - startedAt)}] ${message}\n`);
}

function formatClock(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function displayDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}` : value;
}

function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(3)}s`;
}

void main();
