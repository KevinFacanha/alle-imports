import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Prisma } from '@prisma/client';

import { FinancialEvidenceRecord } from '../../finance/domain/financial-evidence.types.js';
import { MercadoLivreClientError } from '../../marketplaces/mercado-livre/mercado-livre.client.js';
import {
  SellerMetricEvidence,
  SellerMetricsReconciliationService,
} from './seller-metrics-reconciliation.service.js';

const MARKETPLACE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const OLIST_ACCOUNT_ID = '00000000-0000-4000-8000-000000000102';
const DATE = '2026-09-16';
const REPORT_PATH = '/private/reports/gefinance-secret.xlsx';

describe('SellerMetricsReconciliationService', () => {
  it('reconciles three isolated sources, Full, Decimal margin and safe three-way matching without averaging', async () => {
    const inspection = new InspectionFake(inspectionReport());
    const provider = new FinancialProviderFake([
      financialRecord({ orderReference: 'ML-1', total: '90.10', margin: '18.02' }),
      financialRecord({ orderReference: 'PACK-A', total: '20.20', margin: '2.02' }),
      financialRecord({ orderReference: 'ML-C', total: '30.30', margin: '3.03' }),
      financialRecord({ orderReference: 'NO-MATCH', total: '10.40', margin: '1.04', full: true }),
      financialRecord({
        orderReference: 'OTHER-ACCOUNT',
        total: '9999.99',
        margin: '999.99',
        channel: 'OTHER',
      }),
    ]);
    const visits = new VisitsClientFake(1739);
    const service = new SellerMetricsReconciliationService(
      inspection as never,
      visits as never,
      (path) => {
        provider.paths.push(path);
        return provider;
      },
    );

    const report = await service.reconcile({
      marketplaceAccountId: MARKETPLACE_ACCOUNT_ID,
      olistAccountId: OLIST_ACCOUNT_ID,
      date: DATE,
      geFinanceReportPath: REPORT_PATH,
    });

    assert.deepEqual(inspection.params, [{
      marketplaceAccountId: MARKETPLACE_ACCOUNT_ID,
      olistAccountId: OLIST_ACCOUNT_ID,
      date: DATE,
    }]);
    assert.deepEqual(provider.paths, [REPORT_PATH]);
    assert.equal(report.mode, 'READ_ONLY');
    assert.equal(report.persistence, 'DISABLED');
    assert.equal(report.timeZone, 'America/Sao_Paulo');
    assert.equal(report.accountIsolation.excludedGeFinanceRecords, 1);
    assert.equal(report.comparisonPolicy.nearTolerance, null);
    assert.equal(report.comparisonPolicy.nearStatusUsed, false);
    assert.equal(report.comparisonPolicy.averagingAcrossSources, false);

    assert.equal(metric(report.general, 'salesCount', 'MERCADO_LIVRE_OFFICIAL').value, 2);
    assert.equal(metric(report.general, 'salesCount', 'OLIST_TINY_V3').status, 'EXACT');
    assert.equal(metric(report.general, 'salesCount', 'GEFINANCE_XLSX').status, 'INCOMPATIBLE_SEMANTICS');
    assert.equal(metric(report.general, 'unitsSold', 'MERCADO_LIVRE_OFFICIAL').value, 3);
    assert.equal(metric(report.general, 'unitsSold', 'OLIST_TINY_V3').value, null);
    assert.equal(metric(report.general, 'unitsSold', 'OLIST_TINY_V3').status, 'INCOMPATIBLE_SEMANTICS');
    assert.equal(metric(report.general, 'grossSales', 'MERCADO_LIVRE_OFFICIAL').value, '100.00');
    assert.equal(metric(report.general, 'grossSales', 'OLIST_TINY_V3').value, '98.00');
    assert.equal(metric(report.general, 'grossSales', 'OLIST_TINY_V3').absoluteDifference, '2');
    assert.equal(metric(report.general, 'grossSales', 'GEFINANCE_XLSX').value, '151.00');
    assert.equal(metric(report.general, 'visits', 'MERCADO_LIVRE_OFFICIAL').value, 1739);

    assert.equal(report.geFinanceMargin.generalRate, '15.9668874172');
    assert.equal(report.geFinanceMargin.fullRate, '10');
    assert.equal(metric(report.full.evidence, 'salesCount', 'MERCADO_LIVRE_OFFICIAL').value, 1);
    assert.equal(metric(report.full.evidence, 'unitsSold', 'MERCADO_LIVRE_OFFICIAL').value, 2);
    assert.equal(metric(report.full.evidence, 'grossSales', 'MERCADO_LIVRE_OFFICIAL').value, '40.00');
    assert.equal(metric(report.full.evidence, 'grossSales', 'OLIST_TINY_V3').value, '38.00');
    assert.equal(metric(report.full.evidence, 'grossSales', 'GEFINANCE_XLSX').value, '10.40');

    assert.deepEqual(report.matching.mlOlist, {
      MATCHED_EXACT: 1,
      AMBIGUOUS: 2,
      UNMATCHED: 1,
      CONFLICT: 1,
      totalOlistOrders: 5,
    });
    assert.deepEqual(report.matching.threeSources, {
      MATCHED_EXACT: 1,
      AMBIGUOUS: 1,
      UNMATCHED: 1,
      CONFLICT: 1,
      geFinanceRecords: 4,
      distinctGeFinanceReferences: 4,
      method: 'GeFinance Número E-commerce -> ML order/pack -> Olist',
    });
    assert.equal(report.matching.identifiersExposed, false);

    const mlTicket = metric(report.general, 'averageTicketCandidate', 'MERCADO_LIVRE_OFFICIAL');
    const olistTicket = metric(report.general, 'averageTicketCandidate', 'OLIST_TINY_V3');
    assert.equal(mlTicket.value, '50.00');
    assert.equal(olistTicket.value, '49.00');
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('49.50'), false);
    assert.equal(serialized.includes('Pessoa Confidencial'), false);
    assert.equal(serialized.includes(REPORT_PATH), false);
    assert.equal(serialized.includes('ML-1'), false);
    assert.equal(serialized.includes('PACK-A'), false);
    assert.equal(serialized.includes(MARKETPLACE_ACCOUNT_ID), false);
    assert.equal(serialized.includes(OLIST_ACCOUNT_ID), false);
  });

  it('marks unavailable official sources and rejects partial Full classification totals', async () => {
    const reportData = inspectionReport();
    reportData.full.officialMlClassification.classificationErrors = 1;
    const service = new SellerMetricsReconciliationService(
      new InspectionFake(reportData) as never,
      new VisitsClientFake(
        new MercadoLivreClientError(
          'Mercado Livre rejected the visits request.',
          'REQUEST_FAILED',
          403,
        ),
      ) as never,
      () => new FinancialProviderFake([]),
    );

    const report = await service.reconcile({
      marketplaceAccountId: MARKETPLACE_ACCOUNT_ID,
      olistAccountId: OLIST_ACCOUNT_ID,
      date: DATE,
      geFinanceReportPath: REPORT_PATH,
    });

    const visits = metric(report.general, 'visits', 'MERCADO_LIVRE_OFFICIAL');
    assert.equal(visits.status, 'UNAVAILABLE');
    assert.match(visits.notes, /^ACCESS_DENIED:/);
    assert.equal(visits.value, null);
    assert.equal(metric(report.full.evidence, 'salesCount', 'MERCADO_LIVRE_OFFICIAL').status, 'UNAVAILABLE');
    assert.equal(metric(report.full.evidence, 'unitsSold', 'MERCADO_LIVRE_OFFICIAL').status, 'UNAVAILABLE');
    assert.equal(metric(report.full.evidence, 'grossSales', 'MERCADO_LIVRE_OFFICIAL').status, 'UNAVAILABLE');
  });
});

function metric(
  rows: SellerMetricEvidence[],
  name: string,
  source: SellerMetricEvidence['source'],
): SellerMetricEvidence {
  const found = rows.find((row) => row.metric === name && row.source === source);
  assert.ok(found, `${name}/${source} should exist`);
  return found;
}

class InspectionFake {
  readonly params: unknown[] = [];

  constructor(private readonly report: ReturnType<typeof inspectionReport>) {}

  async inspect(params: unknown) {
    this.params.push(params);
    return this.report;
  }
}

class VisitsClientFake {
  constructor(private readonly result: number | Error) {}

  async getUserVisits() {
    if (this.result instanceof Error) {
      throw this.result;
    }
    return { total_visits: this.result };
  }
}

class FinancialProviderFake {
  readonly paths: string[] = [];

  constructor(private readonly records: FinancialEvidenceRecord[]) {}

  async getFinancialEvidence() {
    return {
      source: 'GEFINANCE_REPORT' as const,
      date: DATE,
      records: this.records,
      marginDefinition: {
        amountColumn: 'Margem',
        baseColumn: 'Total prod. vendidos',
        reportedRateColumn: '% sobre Venda',
      },
    };
  }
}

function inspectionReport() {
  return {
    period: { timeZone: 'America/Sao_Paulo' },
    accounts: {
      correlation: {
        marketplaceAccount: {
          id: MARKETPLACE_ACCOUNT_ID,
          sellerId: '1196767962',
        },
      },
    },
    mercadoLivre: {
      ordersCount: 2,
      units: 3,
      orderAmountByCurrency: [{ currency: 'BRL', amount: '100.00' }],
    },
    olist: {
      ordersCount: 2,
      totalProdutos: '98.00',
      totalProdutosCoverage: { ordersWithValue: 2, missingOrders: 0 },
    },
    full: {
      officialMlClassification: {
        ordersCount: 1,
        units: 2,
        orderAmountByCurrency: [{ currency: 'BRL', amount: '40.00' }],
        classificationErrors: 0,
      },
      olistChannel: {
        ordersCount: 1,
        totalProdutos: '38.00',
        totalProdutosCoverage: { ordersWithValue: 1, missingOrders: 0 },
      },
    },
    matching: {
      matchedExact: 1,
      ambiguous: 2,
      unmatched: 1,
      conflict: 1,
      rows: [
        matchingRow('OLIST-1', 'MATCHED_EXACT', ['ML-1'], []),
        matchingRow('OLIST-2', 'AMBIGUOUS', [], ['PACK-A']),
        matchingRow('OLIST-3', 'AMBIGUOUS', [], ['PACK-A']),
        matchingRow('OLIST-4', 'CONFLICT', ['ML-C'], []),
        matchingRow('OLIST-5', 'UNMATCHED', [], []),
      ],
    },
  };
}

function matchingRow(
  olistOrderId: string,
  status: 'MATCHED_EXACT' | 'AMBIGUOUS' | 'UNMATCHED' | 'CONFLICT',
  mlOrderIds: string[],
  mlPackIds: string[],
) {
  return {
    olistOrderId,
    status,
    method: null,
    mlOrderIds,
    mlPackIds,
  };
}

function financialRecord(options: {
  orderReference: string;
  total: string;
  margin: string;
  full?: boolean;
  channel?: 'OTHER';
}): FinancialEvidenceRecord {
  const total = new Prisma.Decimal(options.total);
  const margin = new Prisma.Decimal(options.margin);
  const zero = new Prisma.Decimal(0);
  const full = options.full ?? false;
  return {
    soldOn: DATE,
    orderReference: options.orderReference,
    channel: {
      original: options.channel === 'OTHER'
        ? 'Another account'
        : full
          ? 'Mercado Livre Fulfillment C2'
          : 'ML_ALEIMMPORTS 2',
      normalized: options.channel === 'OTHER'
        ? 'OTHER'
        : full
          ? 'MERCADO_LIVRE_FULFILLMENT_C2'
          : 'MERCADO_LIVRE_ACCOUNT_2',
    },
    status: 'Entregue',
    productSoldAmount: total,
    discountAmount: zero,
    totalProductsSoldAmount: total,
    customerShippingAmount: zero,
    totalSaleAmount: total,
    productCostAmount: zero,
    feesAndCommissionsAmount: zero,
    taxAmount: zero,
    netAmount: total,
    marginAmount: margin,
    reportedMarginRate: margin.dividedBy(total),
    marginBaseAmount: total,
    isFinancialFulfillmentEvidence: full,
    ...({ customerName: 'Pessoa Confidencial' } as object),
  };
}
