import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import {
  DailySalesSummaryError,
  DailySalesSummaryService,
} from '../modules/analytics/application/daily-sales-summary.service.js';

interface CliArguments {
  accountId: string;
  date: string;
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const summary = await application
      .get(DailySalesSummaryService)
      .summarize({
        marketplaceAccountId: args.accountId,
        date: args.date,
      });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error: unknown) {
    const message =
      error instanceof CliArgumentError ||
      error instanceof DailySalesSummaryError
        ? error.message
        : `Daily sales summary failed (${errorName(error)}).`;
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
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }

  const accountId = values.get('account-id');
  const date = values.get('date');
  if (!accountId || !date || values.size !== 2) {
    throw usageError();
  }

  return { accountId, date };
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run analytics:daily-sales -- --account-id=<UUID> --date=YYYY-MM-DD',
  );
}

void main();
