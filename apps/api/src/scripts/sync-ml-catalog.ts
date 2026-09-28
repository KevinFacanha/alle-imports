import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import { TokenEncryptionError } from '../modules/integrations/oauth/token-encryption.service.js';
import { MercadoLivreClientError } from '../modules/marketplaces/mercado-livre/mercado-livre.client.js';
import {
  CatalogAccountAlias,
  MercadoLivreCatalogSyncService,
} from '../modules/marketplaces/mercado-livre/mercado-livre-catalog-sync.service.js';
import { MercadoLivreOAuthError } from '../modules/marketplaces/mercado-livre/oauth/mercado-livre-oauth.types.js';
import { MarketplaceAuthorizationNotFoundError } from '../modules/marketplaces/mercado-livre/oauth/marketplace-authorization.service.js';

interface CliArguments {
  accounts: CatalogAccountAlias[];
  dryRun: boolean;
}

async function main(): Promise<void> {
  let application;
  try {
    const args = parseArguments(process.argv.slice(2));
    application = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    const service = application.get(MercadoLivreCatalogSyncService);
    const results = [];

    for (const account of args.accounts) {
      const result = await service.syncAccount(
        account,
        args.dryRun,
        (progress) => {
          process.stderr.write(
            `${JSON.stringify({ event: 'progress', ...progress })}\n`,
          );
        },
      );
      results.push(result);
    }

    const audit = args.dryRun
      ? service.buildDryRunAudit(results)
      : await service.auditPersistedCatalog(args.accounts);
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: args.dryRun ? 'dry-run' : 'sync',
          summaries: results.map((result) => result.summary),
          audit,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error: unknown) {
    const safeErrors = [
      CliArgumentError,
      MercadoLivreClientError,
      MercadoLivreOAuthError,
      MarketplaceAuthorizationNotFoundError,
      TokenEncryptionError,
    ];
    const isSafeError = safeErrors.some(
      (errorType) => error instanceof errorType,
    );
    const message = isSafeError
      ? (error as Error).message
      : `Mercado Livre catalog sync failed (${errorName(error)}).`;
    const diagnostics =
      error instanceof MercadoLivreClientError
        ? [
            error.upstreamCode ? `code=${error.upstreamCode}` : "",
            error.blockedBy ? `blocked_by=${error.blockedBy}` : "",
          ]
            .filter(Boolean)
            .join(", ")
        : "";
    process.stderr.write(
      `${message}${diagnostics ? ` (${diagnostics})` : ""}\n`,
    );
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
  let account: string | undefined;
  let dryRun = false;

  for (const argument of args) {
    if (argument === '--dry-run') {
      if (dryRun) throw usageError();
      dryRun = true;
      continue;
    }
    if (argument.startsWith('--account=') && account === undefined) {
      account = argument.slice('--account='.length).toLowerCase();
      continue;
    }
    throw usageError();
  }

  if (!account || !['c1', 'c2', 'all'].includes(account)) {
    throw usageError();
  }
  return {
    accounts: account === 'all' ? ['c1', 'c2'] : [account as CatalogAccountAlias],
    dryRun,
  };
}

function usageError(): CliArgumentError {
  return new CliArgumentError(
    'Usage: npm run sync:ml-catalog -- --account=c1|c2|all [--dry-run]',
  );
}

void main();
