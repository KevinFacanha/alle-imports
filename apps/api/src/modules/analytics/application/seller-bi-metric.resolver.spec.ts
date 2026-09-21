import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SellerMetricEvidence,
  SellerMetricsReconciliationResult,
} from './seller-metrics-reconciliation.service.js';
import { SellerBiMetricResolver } from './seller-bi-metric.resolver.js';

describe('SellerBiMetricResolver', () => {
  it('resolves the official source policy without averaging divergent sources', () => {
    const result = new SellerBiMetricResolver().resolve(reconciliation());

    assert.deepEqual(result.metrics.salesCount, {
      value: 2,
      source: 'MERCADO_LIVRE',
      status: 'AVAILABLE',
      confidence: 'HIGH',
      validationEvidence: result.metrics.salesCount.validationEvidence,
      notes: ['Olist valida a contagem e nunca substitui a fonte primária.'],
    });
    assert.equal(result.metrics.unitsSold.value, 3);
    assert.equal(result.metrics.unitsSold.source, 'MERCADO_LIVRE');
    assert.equal(
      evidence(result, 'unitsSold', 'OLIST').status,
      'INCOMPATIBLE_SEMANTICS',
    );
    assert.equal(
      evidence(result, 'unitsSold', 'OLIST').comparison,
      'NOT_COMPARABLE',
    );

    assert.equal(result.metrics.grossSales.value, '100.00');
    assert.equal(result.metrics.grossSales.source, 'MERCADO_LIVRE');
    assert.equal(result.metrics.grossSales.status, 'PROVISIONAL');
    assert.equal(result.metrics.grossSales.confidence, 'MEDIUM');
    assert.equal(
      evidence(result, 'grossSales', 'OLIST').comparison,
      'DIVERGENT',
    );
    assert.equal(
      evidence(result, 'grossSales', 'OLIST').absoluteDifference,
      '2',
    );
    assert.equal(
      result.metrics.grossSales.validationEvidence.some(
        (item) => item.source === 'GEFINANCE',
      ),
      false,
    );

    assert.equal(result.metrics.marginRate.value, '15.9668874172');
    assert.equal(result.metrics.marginRate.source, 'GEFINANCE');
    assert.equal(
      evidence(result, 'marginRate', 'GEFINANCE').semantic,
      'SUM(Margem) / SUM(Total prod. vendidos)',
    );

    assert.equal(
      result.metrics.fullClassification.value,
      'shipment.logistic_type = fulfillment',
    );
    assert.equal(result.metrics.fullClassification.source, 'MERCADO_LIVRE');
    assert.equal(result.metrics.fullSalesCount.value, 1);
    assert.equal(result.metrics.fullSalesCount.source, 'MERCADO_LIVRE');
    assert.equal(result.metrics.fullUnitsSold.value, 2);
    assert.equal(
      evidence(result, 'fullUnitsSold', 'OLIST').status,
      'INCOMPATIBLE_SEMANTICS',
    );

    assert.equal(result.metrics.fullGrossSales.value, '38.00');
    assert.equal(result.metrics.fullGrossSales.source, 'OLIST');
    assert.equal(result.metrics.fullGrossSales.status, 'PROVISIONAL');
    assert.equal(
      evidence(result, 'fullGrossSales', 'MERCADO_LIVRE').comparison,
      'DIVERGENT',
    );
    assert.equal(
      evidence(result, 'fullGrossSales', 'MERCADO_LIVRE')
        .absoluteDifference,
      '2',
    );
    assert.equal(
      evidence(result, 'fullGrossSales', 'GEFINANCE').comparison,
      'DIVERGENT',
    );
    assert.equal(
      evidence(result, 'fullGrossSales', 'GEFINANCE').absoluteDifference,
      '27.6',
    );

    assert.equal(result.metrics.averageTicket.value, '50.00');
    assert.equal(result.metrics.averageTicket.source, 'DERIVED');
    assert.equal(result.metrics.averageTicket.status, 'PROVISIONAL');

    assert.notEqual(result.metrics.grossSales.value, '99.00');
    assert.notEqual(result.metrics.fullGrossSales.value, '39.00');
  });

  it('keeps visits and conversion unavailable on Mercado Livre HTTP 403', () => {
    const input = reconciliation();
    const visit = input.general.find(
      (row) =>
        row.metric === 'visits' && row.source === 'MERCADO_LIVRE_OFFICIAL',
    );
    assert.ok(visit);
    visit.value = null;
    visit.status = 'UNAVAILABLE';
    visit.semantic = 'NO_EQUIVALENT_AVAILABLE';
    visit.notes = 'ACCESS_DENIED: official ML visits (REQUEST_FAILED).';

    const result = new SellerBiMetricResolver().resolve(input);

    assert.equal(result.metrics.visits.value, null);
    assert.equal(result.metrics.visits.source, 'MERCADO_LIVRE');
    assert.equal(result.metrics.visits.status, 'UNAVAILABLE');
    assert.equal(result.metrics.visits.confidence, 'LOW');
    assert.match(result.metrics.visits.notes.join(' '), /ACCESS_DENIED/);
    assert.equal(result.metrics.conversionRate.value, null);
    assert.equal(result.metrics.conversionRate.source, 'DERIVED');
    assert.equal(result.metrics.conversionRate.status, 'UNAVAILABLE');
  });

  it('derives conversion from resolved sales and visits when visits are available', () => {
    const input = reconciliation();
    const visit = input.general.find(
      (row) =>
        row.metric === 'visits' && row.source === 'MERCADO_LIVRE_OFFICIAL',
    );
    assert.ok(visit);
    visit.value = 1739;
    visit.status = 'EXACT';

    const result = new SellerBiMetricResolver().resolve(input);

    assert.equal(result.metrics.conversionRate.value, '0.0011500863');
    assert.equal(result.metrics.conversionRate.status, 'AVAILABLE');
    assert.equal(result.metrics.conversionRate.confidence, 'HIGH');
  });

  it('does not use validation sources as fallback and keeps calls account-isolated', () => {
    const account2 = reconciliation();
    const otherAccount = reconciliation();
    otherAccount.accountIsolation.excludedGeFinanceRecords = 7;
    setValue(otherAccount.general, 'salesCount', 'MERCADO_LIVRE_OFFICIAL', 3);
    setValue(otherAccount.general, 'grossSales', 'MERCADO_LIVRE_OFFICIAL', null);
    setValue(otherAccount.general, 'grossSales', 'OLIST_TINY_V3', '999.00');

    const resolver = new SellerBiMetricResolver();
    const first = resolver.resolve(account2);
    const second = resolver.resolve(otherAccount);

    assert.equal(first.metrics.salesCount.value, 2);
    assert.equal(first.accountIsolation.excludedGeFinanceRecords, 1);
    assert.equal(second.metrics.salesCount.value, 3);
    assert.equal(second.accountIsolation.excludedGeFinanceRecords, 7);
    assert.equal(second.metrics.grossSales.value, null);
    assert.equal(second.metrics.grossSales.source, 'MERCADO_LIVRE');
    assert.equal(second.metrics.grossSales.status, 'UNAVAILABLE');
    assert.equal(
      evidence(second, 'grossSales', 'OLIST').status,
      'AVAILABLE',
    );
  });
});

function evidence(
  result: ReturnType<SellerBiMetricResolver['resolve']>,
  metric: keyof typeof result.metrics,
  source: 'MERCADO_LIVRE' | 'OLIST' | 'GEFINANCE',
) {
  const found = result.metrics[metric].validationEvidence.find(
    (item) => item.metric === metric && item.source === source,
  );
  assert.ok(found, `${metric}/${source} evidence should exist`);
  return found;
}

function setValue(
  rows: SellerMetricEvidence[],
  metric: string,
  source: SellerMetricEvidence['source'],
  value: string | number | null,
): void {
  const found = rows.find(
    (row) => row.metric === metric && row.source === source,
  );
  assert.ok(found, `${metric}/${source} should exist`);
  found.value = value;
  found.status = value === null ? 'UNAVAILABLE' : 'DIFFERENT';
}

function reconciliation(): SellerMetricsReconciliationResult {
  return {
    mode: 'READ_ONLY',
    persistence: 'DISABLED',
    date: '2026-09-16',
    timeZone: 'America/Sao_Paulo',
    comparisonPolicy: {
      reference: 'MERCADO_LIVRE_WHEN_SEMANTICALLY_COMPATIBLE',
      nearTolerance: null,
      nearStatusUsed: false,
      averagingAcrossSources: false,
    },
    accountIsolation: {
      marketplace: 'EXACT_ID',
      olist: 'EXACT_ID',
      geFinance: 'ACCOUNT_2_CHANNEL_ALLOWLIST',
      excludedGeFinanceRecords: 1,
    },
    general: [
      row('salesCount', 'MERCADO_LIVRE_OFFICIAL', 2, 'COUNT(official ML orders created in the local day)', 'EXACT'),
      row('salesCount', 'OLIST_TINY_V3', 2, 'COUNT(Olist orders in the Account 2 channel allowlist)', 'EXACT'),
      row('unitsSold', 'MERCADO_LIVRE_OFFICIAL', 3, 'SUM(ML order_items.quantity)', 'EXACT'),
      row('unitsSold', 'OLIST_TINY_V3', null, 'Olist item.quantidade (excluded from commercial units)', 'INCOMPATIBLE_SEMANTICS'),
      row('grossSales', 'MERCADO_LIVRE_OFFICIAL', '100.00', 'SUM(ML order.total_amount), BRL', 'EXACT'),
      row('grossSales', 'OLIST_TINY_V3', '98.00', 'SUM(Olist valorTotalProdutos / totalProdutos)', 'DIFFERENT'),
      row('grossSales', 'GEFINANCE_XLSX', '151.00', 'SUM(GeFinance Valor do produto vendido)', 'DIFFERENT'),
      row('marginRate', 'GEFINANCE_XLSX', '15.9668874172', 'SUM(Margem) / SUM(Total prod. vendidos)', 'EXACT'),
      row('visits', 'MERCADO_LIVRE_OFFICIAL', null, 'ML official user visits for the requested day', 'UNAVAILABLE'),
    ],
    full: {
      primaryClassification: 'ML shipment.logistic_type = fulfillment',
      evidence: [
        row('salesCount', 'MERCADO_LIVRE_OFFICIAL', 1, 'COUNT(ML orders with shipment.logistic_type=fulfillment)', 'EXACT'),
        row('salesCount', 'OLIST_TINY_V3', 1, 'COUNT(Olist channel Mercado Livre Fulfillment)', 'EXACT'),
        row('unitsSold', 'MERCADO_LIVRE_OFFICIAL', 2, 'SUM(ML order_items.quantity) for fulfillment shipments', 'EXACT'),
        row('unitsSold', 'OLIST_TINY_V3', null, 'Olist item.quantidade (excluded from commercial units)', 'INCOMPATIBLE_SEMANTICS'),
        row('grossSales', 'MERCADO_LIVRE_OFFICIAL', '40.00', 'SUM(ML order.total_amount) for fulfillment shipments, BRL', 'EXACT'),
        row('grossSales', 'OLIST_TINY_V3', '38.00', 'SUM(Olist totalProdutos), channel Mercado Livre Fulfillment', 'DIFFERENT'),
        row('grossSales', 'GEFINANCE_XLSX', '10.40', 'SUM(GeFinance Total prod. vendidos), channel Mercado Livre Fulfillment C2', 'DIFFERENT'),
        row('grossSales', 'GEFINANCE_XLSX', '10.40', 'SUM(GeFinance Valor do produto vendido), channel Mercado Livre Fulfillment C2', 'DIFFERENT'),
      ],
    },
    geFinanceMargin: {
      formula: 'SUM(Margem) / SUM(Total prod. vendidos)',
      generalRate: '15.9668874172',
      fullRate: '10',
    },
    matching: {
      identifiersExposed: false,
      mlOlist: {
        MATCHED_EXACT: 0,
        AMBIGUOUS: 0,
        UNMATCHED: 0,
        CONFLICT: 0,
        totalOlistOrders: 0,
      },
      threeSources: {
        MATCHED_EXACT: 0,
        AMBIGUOUS: 0,
        UNMATCHED: 0,
        CONFLICT: 0,
        geFinanceRecords: 0,
        distinctGeFinanceReferences: 0,
        method: 'GeFinance Número E-commerce -> ML order/pack -> Olist',
      },
    },
    metricsWithoutEquivalentSource: [],
    reliableCandidateSources: [],
  };
}

function row(
  metric: string,
  source: SellerMetricEvidence['source'],
  value: string | number | null,
  semantic: string,
  status: SellerMetricEvidence['status'],
): SellerMetricEvidence {
  return {
    metric,
    source,
    value,
    semantic,
    status,
    comparisonSource: null,
    absoluteDifference: null,
    percentageDifference: null,
    notes: `${source} evidence`,
  };
}
