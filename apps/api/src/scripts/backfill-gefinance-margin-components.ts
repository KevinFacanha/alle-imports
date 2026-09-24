import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { Marketplace, Prisma } from '@prisma/client';

import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import { DailySellerMetricsPersistenceService } from '../modules/analytics/application/daily-seller-metrics-persistence.service.js';
import { summarizeFinancialEvidence } from '../modules/finance/application/financial-evidence-summary.js';
import {
  FinancialChannelCode,
  FinancialEvidenceRecord,
} from '../modules/finance/domain/financial-evidence.types.js';
import { GeFinanceReportProvider } from '../modules/integrations/gefinance/gefinance-report.provider.js';

interface FixtureInput {
  label: 'C1' | 'C2';
  accountName: 'ALE_IMPORTS1' | 'ALE_IMPORTS 2';
  file: string;
  channels: ReadonlySet<FinancialChannelCode>;
}

const fixtureRoot = resolve(process.cwd(), '.local-fixtures', 'gefinance');
const inputs: readonly FixtureInput[] = [
  {
    label: 'C1',
    accountName: 'ALE_IMPORTS1',
    file: resolve(fixtureRoot, 'gefinance-c1-latest.xlsx'),
    channels: new Set([
      'MERCADO_LIVRE_ACCOUNT_1',
      'MERCADO_LIVRE_FULFILLMENT_C1',
    ]),
  },
  {
    label: 'C2',
    accountName: 'ALE_IMPORTS 2',
    file: resolve(fixtureRoot, 'gefinance-c2-latest.xlsx'),
    channels: new Set([
      'MERCADO_LIVRE_ACCOUNT_2',
      'MERCADO_LIVRE_FULFILLMENT_C2',
    ]),
  },
];

async function main(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const database = application.get(DatabaseService);
    const persistence = application.get(DailySellerMetricsPersistenceService);
    const results = [];

    for (const input of inputs) {
      const accounts = await database.marketplaceAccount.findMany({
        where: {
          name: input.accountName,
          marketplace: Marketplace.MERCADO_LIVRE,
          active: true,
        },
        select: { id: true, name: true },
      });
      if (accounts.length !== 1) {
        throw new Error(
          `${input.label}: expected exactly one active ${input.accountName} account, found ${accounts.length}.`,
        );
      }

      const provider = new GeFinanceReportProvider(input.file);
      const inspection = await provider.inspectReport();
      const unexpectedChannels = inspection.channels.filter(
        ({ normalized }) => !input.channels.has(normalized),
      );
      if (unexpectedChannels.length > 0) {
        throw new Error(`${input.label}: XLSX contains a channel from another account.`);
      }

      const counts = { enriched: 0, unchanged: 0, missingSnapshot: 0 };
      let marginAmount = new Prisma.Decimal(0);
      let marginBaseAmount = new Prisma.Decimal(0);
      for (const day of inspection.days) {
        const report = await provider.getFinancialEvidence({
          date: day.businessDate,
        });
        const records = report.records.filter((record) =>
          input.channels.has(record.channel.normalized),
        );
        assertAccountIsolation(input, report.records, records);
        const summary = summarizeFinancialEvidence({ ...report, records });
        const action = await persistence.backfillGeFinanceMarginComponents({
          marketplaceAccountId: accounts[0]!.id,
          businessDate: day.businessDate,
          marginAmount: summary.aggregateMargin.amount,
          marginBaseAmount: summary.aggregateMargin.baseAmount,
        });
        if (action !== 'MISSING_SNAPSHOT') {
          marginAmount = marginAmount.plus(summary.aggregateMargin.amount);
          marginBaseAmount = marginBaseAmount.plus(
            summary.aggregateMargin.baseAmount,
          );
        }
        if (action === 'ENRICHED') counts.enriched += 1;
        if (action === 'UNCHANGED') counts.unchanged += 1;
        if (action === 'MISSING_SNAPSHOT') counts.missingSnapshot += 1;
      }

      results.push({
        account: input.label,
        marketplaceAccountId: accounts[0]!.id,
        name: accounts[0]!.name,
        businessDatesInFixture: inspection.days.length,
        snapshotsFound: counts.enriched + counts.unchanged,
        marginAmount: marginAmount.toString(),
        marginBaseAmount: marginBaseAmount.toString(),
        marginRate: marginBaseAmount.isZero()
          ? null
          : marginAmount.dividedBy(marginBaseAmount).mul(100).toDecimalPlaces(10).toString(),
        ...counts,
      });
    }

    process.stdout.write(
      `${JSON.stringify({ externalCalls: 0, results }, null, 2)}\n`,
    );
  } finally {
    await application.close();
  }
}

function assertAccountIsolation(
  input: FixtureInput,
  allRecords: readonly FinancialEvidenceRecord[],
  acceptedRecords: readonly FinancialEvidenceRecord[],
): void {
  if (allRecords.length !== acceptedRecords.length) {
    throw new Error(`${input.label}: account isolation rejected XLSX records.`);
  }
}

void main();
