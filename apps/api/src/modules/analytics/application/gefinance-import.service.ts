import { Inject, Injectable } from '@nestjs/common';
import { Marketplace } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import { FinancialEvidenceProvider } from '../../finance/domain/financial-evidence.provider.js';
import { FinancialChannelCode } from '../../finance/domain/financial-evidence.types.js';
import {
  GeFinanceReportInspection,
  GeFinanceReportProvider,
} from '../../integrations/gefinance/gefinance-report.provider.js';
import {
  DailySellerMetricsBackfillService,
  DailySellerMetricsBackfillSummary,
} from './daily-seller-metrics-backfill.service.js';
import {
  GEFINANCE_PROVIDER_FACTORY,
  GeFinanceProviderFactory,
} from './seller-metrics-reconciliation.service.js';

const CHANNEL_ACCOUNT_ORDINALS: Partial<
  Record<FinancialChannelCode, number>
> = {
  MERCADO_LIVRE_ACCOUNT_1: 1,
  MERCADO_LIVRE_ACCOUNT_2: 2,
  MERCADO_LIVRE_FULFILLMENT_C1: 1,
  MERCADO_LIVRE_FULFILLMENT_C2: 2,
};

export interface GeFinanceImportResult {
  report: GeFinanceReportInspection;
  marketplaceAccount: { id: string; name: string };
  olistAccount: { id: string; name: string; integrationKey: string };
  backfill: DailySellerMetricsBackfillSummary;
}

export class GeFinanceImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeFinanceImportError';
  }
}

@Injectable()
export class GeFinanceImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly backfill: DailySellerMetricsBackfillService,
    @Inject(GEFINANCE_PROVIDER_FACTORY)
    private readonly geFinanceProviderFactory: GeFinanceProviderFactory,
  ) {}

  async execute(params: {
    file: string;
    sha256: string;
  }): Promise<GeFinanceImportResult> {
    const provider = this.geFinanceProviderFactory(
      params.file,
    ) as Pick<GeFinanceReportProvider, 'getFinancialEvidence' | 'inspectReport'>;
    const report = await provider.inspectReport();
    const accountOrdinal = reportAccountOrdinal(report);
    const accounts = await this.resolveAccounts(accountOrdinal);
    const backfill = await this.backfill.execute({
      marketplaceAccountId: accounts.marketplaceAccount.id,
      olistAccountId: accounts.olistAccount.id,
      geFinanceReportPath: params.file,
      geFinanceReportSha256: params.sha256,
      geFinanceProvider: provider as FinancialEvidenceProvider,
      from: report.from,
      to: report.to,
    });

    return { report, ...accounts, backfill };
  }

  private async resolveAccounts(accountOrdinal: number): Promise<{
    marketplaceAccount: { id: string; name: string };
    olistAccount: { id: string; name: string; integrationKey: string };
  }> {
    const [marketplaceAccounts, olistAccounts] = await Promise.all([
      this.database.marketplaceAccount.findMany({
        where: { marketplace: Marketplace.MERCADO_LIVRE, active: true },
        select: { id: true, name: true },
      }),
      this.database.olistAccount.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          authorization: { select: { integrationKey: true } },
        },
      }),
    ]);
    const marketplaceMatches = marketplaceAccounts.filter(
      ({ name }) => accountNameParts(name).ordinal === accountOrdinal,
    );
    if (marketplaceMatches.length !== 1) {
      throw new GeFinanceImportError(
        `Não foi possível identificar de forma inequívoca a MarketplaceAccount da conta ${accountOrdinal}: esperada 1 conta Mercado Livre ativa, encontradas ${marketplaceMatches.length}.`,
      );
    }

    const marketplaceAccount = marketplaceMatches[0]!;
    const expectedIntegrationKey = `c${accountOrdinal}`;
    const olistMatches = olistAccounts.filter(
      ({ authorization }) =>
        authorization?.integrationKey === expectedIntegrationKey,
    );
    if (olistMatches.length !== 1) {
      throw new GeFinanceImportError(
        `Não foi possível identificar de forma inequívoca a OlistAccount relacionada a "${marketplaceAccount.name}": esperada 1 conta Olist ativa com integrationKey=${expectedIntegrationKey}, encontradas ${olistMatches.length}.`,
      );
    }

    const olistAccount = olistMatches[0]!;
    return {
      marketplaceAccount,
      olistAccount: {
        id: olistAccount.id,
        name: olistAccount.name,
        integrationKey: olistAccount.authorization!.integrationKey,
      },
    };
  }
}

function reportAccountOrdinal(report: GeFinanceReportInspection): number {
  const unsupported = report.channels.filter(
    ({ normalized }) => CHANNEL_ACCOUNT_ORDINALS[normalized] === undefined,
  );
  if (unsupported.length > 0) {
    throw new GeFinanceImportError(
      `O XLSX contém canal(is) sem vínculo seguro com uma MarketplaceAccount: ${unsupported
        .map(({ original }) => JSON.stringify(original))
        .join(', ')}.`,
    );
  }

  const ordinals = new Set(
    report.channels.map(({ normalized }) => CHANNEL_ACCOUNT_ORDINALS[normalized]!),
  );
  if (ordinals.size !== 1) {
    throw new GeFinanceImportError(
      'O XLSX contém canais associados a mais de uma MarketplaceAccount.',
    );
  }
  return [...ordinals][0]!;
}

function accountNameParts(value: string): { base: string; ordinal: number | null } {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  const ordinalMatch = /(\d+)\s*$/.exec(normalized);
  const withoutOrdinal = ordinalMatch
    ? normalized.slice(0, ordinalMatch.index)
    : normalized;
  return {
    base: withoutOrdinal.replace(/[^A-Z0-9]/g, ''),
    ordinal: ordinalMatch ? Number(ordinalMatch[1]) : null,
  };
}
