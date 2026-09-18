import { Prisma } from '@prisma/client';

import {
  FinancialEvidenceRecord,
  FinancialEvidenceReport,
} from '../domain/financial-evidence.types.js';

export interface FinancialTotals {
  productSoldAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalProductsSoldAmount: Prisma.Decimal;
  customerShippingAmount: Prisma.Decimal;
  totalSaleAmount: Prisma.Decimal;
  productCostAmount: Prisma.Decimal;
  feesAndCommissionsAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  marginAmount: Prisma.Decimal;
}

export interface FinancialBreakdown extends FinancialTotals {
  value: string;
  records: number;
  marginRate: Prisma.Decimal | null;
}

export interface FinancialEvidenceSummary {
  source: FinancialEvidenceReport['source'];
  date: string;
  recordCount: number;
  channels: string[];
  statusBreakdown: FinancialBreakdown[];
  totals: FinancialTotals;
  aggregateMargin: {
    amount: Prisma.Decimal;
    baseAmount: Prisma.Decimal;
    baseColumn: string;
    rate: Prisma.Decimal | null;
  };
  byChannel: FinancialBreakdown[];
  financialFullIndicators: FinancialBreakdown & {
    evidenceChannel: string;
    operationalClassification: 'NOT_INFERRED';
  };
}

export function summarizeFinancialEvidence(
  report: FinancialEvidenceReport,
): FinancialEvidenceSummary {
  const totals = sumRecords(report.records);
  const byChannel = groupRecords(report.records, (record) => record.channel.original);
  const statusBreakdown = groupRecords(report.records, (record) => record.status);
  const fullRecords = report.records.filter(
    (record) => record.isFinancialFulfillmentEvidence,
  );
  const fullTotals = sumRecords(fullRecords);

  return {
    source: report.source,
    date: report.date,
    recordCount: report.records.length,
    channels: byChannel.map((entry) => entry.value),
    statusBreakdown,
    totals,
    aggregateMargin: {
      amount: totals.marginAmount,
      baseAmount: totals.totalProductsSoldAmount,
      baseColumn: report.marginDefinition.baseColumn,
      rate: divideOrNull(totals.marginAmount, totals.totalProductsSoldAmount),
    },
    byChannel,
    financialFullIndicators: {
      value: 'Mercado Livre Fulfillment C2',
      evidenceChannel: 'Mercado Livre Fulfillment C2',
      records: fullRecords.length,
      ...fullTotals,
      marginRate: divideOrNull(
        fullTotals.marginAmount,
        fullTotals.totalProductsSoldAmount,
      ),
      operationalClassification: 'NOT_INFERRED',
    },
  };
}

function groupRecords(
  records: FinancialEvidenceRecord[],
  keyOf: (record: FinancialEvidenceRecord) => string,
): FinancialBreakdown[] {
  const groups = new Map<string, FinancialEvidenceRecord[]>();
  for (const record of records) {
    const key = keyOf(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  return [...groups].map(([value, group]) => {
    const totals = sumRecords(group);
    return {
      value,
      records: group.length,
      ...totals,
      marginRate: divideOrNull(
        totals.marginAmount,
        totals.totalProductsSoldAmount,
      ),
    };
  });
}

function sumRecords(records: FinancialEvidenceRecord[]): FinancialTotals {
  const zero = new Prisma.Decimal(0);
  return records.reduce<FinancialTotals>(
    (totals, record) => ({
      productSoldAmount: totals.productSoldAmount.plus(
        record.productSoldAmount,
      ),
      discountAmount: totals.discountAmount.plus(record.discountAmount),
      totalProductsSoldAmount: totals.totalProductsSoldAmount.plus(
        record.totalProductsSoldAmount,
      ),
      customerShippingAmount: totals.customerShippingAmount.plus(
        record.customerShippingAmount,
      ),
      totalSaleAmount: totals.totalSaleAmount.plus(record.totalSaleAmount),
      productCostAmount: totals.productCostAmount.plus(record.productCostAmount),
      feesAndCommissionsAmount: totals.feesAndCommissionsAmount.plus(
        record.feesAndCommissionsAmount,
      ),
      taxAmount: totals.taxAmount.plus(record.taxAmount),
      netAmount: totals.netAmount.plus(record.netAmount),
      marginAmount: totals.marginAmount.plus(record.marginAmount),
    }),
    {
      productSoldAmount: zero,
      discountAmount: zero,
      totalProductsSoldAmount: zero,
      customerShippingAmount: zero,
      totalSaleAmount: zero,
      productCostAmount: zero,
      feesAndCommissionsAmount: zero,
      taxAmount: zero,
      netAmount: zero,
      marginAmount: zero,
    },
  );
}

function divideOrNull(
  numerator: Prisma.Decimal,
  denominator: Prisma.Decimal,
): Prisma.Decimal | null {
  if (denominator.isZero()) {
    return null;
  }
  return numerator.dividedBy(denominator);
}
