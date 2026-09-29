import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import {
  MarketplaceOrderBackfillError,
  MarketplaceOrderBackfillService,
} from '../modules/marketplaces/application/marketplace-order-backfill.service.js';
import { MercadoLivreAccountAlias } from '../modules/marketplaces/mercado-livre/mercado-livre-accounts.js';
import { MercadoLivreClientError } from '../modules/marketplaces/mercado-livre/mercado-livre.client.js';
import { MercadoLivreOAuthError } from '../modules/marketplaces/mercado-livre/oauth/mercado-livre-oauth.types.js';
import { MarketplaceAuthorizationNotFoundError } from '../modules/marketplaces/mercado-livre/oauth/marketplace-authorization.service.js';
import { TokenEncryptionError } from '../modules/integrations/oauth/token-encryption.service.js';

interface CliArguments {
  account: MercadoLivreAccountAlias;
  estimateOnly: boolean;
  resume: boolean;
  runId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  chunkDays: number;
  maxRps: number;
  maxAttempts: number;
  stopAfterChunks?: number;
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseBackfillArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const service = application.get(MarketplaceOrderBackfillService);
    const result = args.estimateOnly
      ? await service.estimate({
          account: args.account,
          dateFrom: args.dateFrom!,
          dateTo: args.dateTo!,
          chunkDays: args.chunkDays,
          maxRps: args.maxRps,
          maxAttempts: args.maxAttempts,
          stopAfterChunks: args.stopAfterChunks,
        })
      : args.resume
        ? await service.resume({
            account: args.account,
            runId: args.runId!,
            stopAfterChunks: args.stopAfterChunks,
          })
        : await service.start({
            account: args.account,
            dateFrom: args.dateFrom!,
            dateTo: args.dateTo!,
            chunkDays: args.chunkDays,
            maxRps: args.maxRps,
            maxAttempts: args.maxAttempts,
            stopAfterChunks: args.stopAfterChunks,
          });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    const safeErrors = [
      CliArgumentError,
      MarketplaceOrderBackfillError,
      MercadoLivreClientError,
      MercadoLivreOAuthError,
      MarketplaceAuthorizationNotFoundError,
      TokenEncryptionError,
    ];
    const safe = safeErrors.some((errorType) => error instanceof errorType);
    process.stderr.write(
      `${safe ? (error as Error).message : safeUnexpectedError(error)}\n`,
    );
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

export class CliArgumentError extends Error {}

export function parseBackfillArguments(args: string[]): CliArguments {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const allowedFlags = new Set(['estimate-only', 'resume']);
  const allowedValues = new Set([
    'account',
    'from',
    'to',
    'chunk-days',
    'run-id',
    'max-rps',
    'max-attempts',
    'stop-after-chunks',
  ]);

  for (const argument of args) {
    if (!argument.startsWith('--')) throw usageError();
    const separator = argument.indexOf('=');
    if (separator === -1) {
      const name = argument.slice(2);
      if (!allowedFlags.has(name) || flags.has(name)) throw usageError();
      flags.add(name);
      continue;
    }
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!allowedValues.has(name) || values.has(name) || value.length === 0) {
      throw usageError();
    }
    values.set(name, value);
  }

  const account = values.get('account');
  if (account !== 'c1' && account !== 'c2') {
    throw new CliArgumentError('--account must be c1 or c2.');
  }
  const estimateOnly = flags.has('estimate-only');
  const resume = flags.has('resume');
  if (estimateOnly && resume) {
    throw new CliArgumentError('--estimate-only and --resume are mutually exclusive.');
  }

  const runId = values.get('run-id');
  const from = values.get('from');
  const to = values.get('to');
  if (resume) {
    if (!runId || !isUuid(runId) || from || to || values.has('chunk-days')) {
      throw new CliArgumentError(
        '--resume requires a valid --run-id and does not accept --from, --to or --chunk-days.',
      );
    }
  } else if (!from || !to || runId) {
    throw new CliArgumentError(
      'A new run requires --from and --to; --run-id is accepted only with --resume.',
    );
  }

  const dateFrom = from ? parseDate(from, '--from') : undefined;
  const dateTo = to ? parseDate(to, '--to') : undefined;
  if (dateFrom && dateTo && dateFrom >= dateTo) {
    throw new CliArgumentError('--from must be before --to.');
  }

  return {
    account,
    estimateOnly,
    resume,
    runId,
    dateFrom,
    dateTo,
    chunkDays: positiveInteger(values.get('chunk-days') ?? '1', '--chunk-days'),
    maxRps: positiveNumber(values.get('max-rps') ?? '1', '--max-rps'),
    maxAttempts: positiveInteger(
      values.get('max-attempts') ?? '5',
      '--max-attempts',
    ),
    stopAfterChunks: values.has('stop-after-chunks')
      ? positiveInteger(values.get('stop-after-chunks')!, '--stop-after-chunks')
      : undefined,
  };
}

function parseDate(value: string, name: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const completeDateTime =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    );
  const normalized = dateOnly
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(normalized);
  const [year, month, day] = value
    .slice(0, 10)
    .split('-')
    .map(Number);
  const validCalendarDate =
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    Number.isNaN(date.getTime()) ||
    (!dateOnly && !completeDateTime) ||
    !validCalendarDate
  ) {
    throw new CliArgumentError(
      `${name} must be YYYY-MM-DD or a complete ISO date-time with timezone.`,
    );
  }
  return date;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliArgumentError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliArgumentError(`${name} must be a positive number.`);
  }
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function safeUnexpectedError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Marketplace order backfill database failure (${error.code}).`;
  }
  return 'Marketplace order backfill failed unexpectedly.';
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run backfill:ml:orders -- --account=c1|c2 (--from=<date> --to=<date> [--estimate-only] | --resume --run-id=<UUID>) [--chunk-days=1] [--max-rps=1] [--max-attempts=5] [--stop-after-chunks=N]',
  );
}

void main();
