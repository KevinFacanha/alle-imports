import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import {
  OlistAuthorizationNotFoundError,
  OlistReauthorizationRequiredError,
} from '../modules/integrations/olist/olist-authorization.service.js';
import { OlistOrdersClientError } from '../modules/integrations/olist/olist-orders.client.js';
import {
  OlistOrdersInspectionError,
  OlistOrdersInspectionService,
} from '../modules/integrations/olist/olist-orders-inspection.service.js';
import { TokenEncryptionError } from '../modules/integrations/oauth/token-encryption.service.js';

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const report = await application.get(OlistOrdersInspectionService).inspectOlistOnly(args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    const safe =
      error instanceof CliArgumentError ||
      error instanceof OlistOrdersInspectionError ||
      error instanceof OlistOrdersClientError ||
      error instanceof OlistAuthorizationNotFoundError ||
      error instanceof OlistReauthorizationRequiredError ||
      error instanceof TokenEncryptionError;
    const message = safe
      ? error instanceof OlistOrdersClientError
        ? `${error.message} (${error.code}${error.statusCode ? `, HTTP ${error.statusCode}` : ''})`
        : (error as Error).message
      : `Olist-only inspection failed (${errorName(error)}).`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await application?.close();
  }
}

function parseArguments(args: string[]): { olistAccountId: string; date: string } {
  const values = new Map<string, string>();
  for (const argument of args) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw usageError();
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  const olistAccountId = values.get('olist-account-id');
  const date = values.get('date');
  if (!olistAccountId || !date || values.size !== 2) throw usageError();
  return { olistAccountId, date };
}

function errorName(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `${error.name}:${error.code}`;
  return error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : 'UnknownError';
}

class CliArgumentError extends Error {}

function usageError(): CliArgumentError {
  return new CliArgumentError('Usage: npm run inspect:olist:only -- --olist-account-id=<UUID> --date=YYYY-MM-DD');
}

void main();
