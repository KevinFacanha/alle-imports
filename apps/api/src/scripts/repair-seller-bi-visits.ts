import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import {
  SellerBiVisitsRefreshError,
  SellerBiVisitsRefreshService,
  SellerBiVisitsRefreshSummary,
} from '../modules/analytics/application/seller-bi-visits-refresh.service.js';

interface CliArguments {
  c1: string;
  c2: string;
  from: string;
  to: string;
  apply: boolean;
}

class RepairCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepairCliError';
  }
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const service = application.get(SellerBiVisitsRefreshService);
    const summaries: Array<{ label: 'C1' | 'C2'; result: SellerBiVisitsRefreshSummary }> = [];
    for (const [label, marketplaceAccountId] of [
      ['C1', args.c1],
      ['C2', args.c2],
    ] as const) {
      const result = await service.refreshRange({
        marketplaceAccountId,
        from: args.from,
        to: args.to,
        apply: args.apply,
      });
      summaries.push({ label, result });
    }
    printSummaries(summaries, args.apply);
    if (summaries.some(({ result }) => result.failed > 0)) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message =
      error instanceof RepairCliError || error instanceof SellerBiVisitsRefreshError
        ? error.message
        : `Seller BI visits repair failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function printSummaries(
  summaries: Array<{ label: 'C1' | 'C2'; result: SellerBiVisitsRefreshSummary }>,
  apply: boolean,
): void {
  const rows = [
    'account | date | persisted visits | corrected visits | delta | salesCount | persisted conversion | corrected conversion | action',
    ...summaries.flatMap(({ label, result }) =>
      result.days.map((day) =>
        [
          label,
          day.businessDate,
          day.persistedVisits ?? 'null',
          day.correctedVisits ?? 'null',
          day.delta ?? 'null',
          day.salesCount ?? 'null',
          day.persistedConversionRate ?? 'null',
          day.correctedConversionRate ?? 'null',
          day.error ? `${day.action}:${day.error}` : day.action,
        ].join(' | '),
      ),
    ),
  ];
  process.stdout.write(`${apply ? 'APPLY' : 'DRY-RUN'}\n${rows.join('\n')}\n`);
  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? 'APPLY' : 'DRY_RUN',
      updated: summaries.reduce((sum, { result }) => sum + result.updated, 0),
      unchanged: summaries.reduce((sum, { result }) => sum + result.unchanged, 0),
      failed: summaries.reduce((sum, { result }) => sum + result.failed, 0),
    })}\n`,
  );
}

function parseArguments(values: string[]): CliArguments {
  const args = new Map<string, string>();
  let apply = false;
  for (const value of values) {
    if (value === '--apply') {
      if (apply) throw usageError();
      apply = true;
      continue;
    }
    const separator = value.indexOf('=');
    if (!value.startsWith('--') || separator < 3) throw usageError();
    const name = value.slice(2, separator);
    if (args.has(name)) throw usageError();
    args.set(name, value.slice(separator + 1));
  }
  const c1 = args.get('c1');
  const c2 = args.get('c2');
  const from = args.get('from');
  const to = args.get('to');
  if (!c1 || !c2 || !from || !to || args.size !== 4) throw usageError();
  return { c1, c2, from, to, apply };
}

function usageError(): RepairCliError {
  return new RepairCliError(
    'Usage: npm run repair:seller-bi:visits -- --c1=<UUID> --c2=<UUID> --from=YYYY-MM-DD --to=YYYY-MM-DD [--apply]',
  );
}

function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : 'UnknownError';
}

void main();
