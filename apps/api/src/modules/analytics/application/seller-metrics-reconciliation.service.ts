import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { summarizeFinancialEvidence } from '../../finance/application/financial-evidence-summary.js';
import { FinancialEvidenceProvider } from '../../finance/domain/financial-evidence.provider.js';
import { FinancialEvidenceReport } from '../../finance/domain/financial-evidence.types.js';
import { GeFinanceReportProvider } from '../../integrations/gefinance/gefinance-report.provider.js';
import {
  OlistOrdersInspectionReport,
  OlistOrdersInspectionService,
} from '../../integrations/olist/olist-orders-inspection.service.js';
import {
  MercadoLivreClient,
  MercadoLivreClientError,
} from '../../marketplaces/mercado-livre/mercado-livre.client.js';

const ACCOUNT_2_CHANNELS = new Set([
  'MERCADO_LIVRE_ACCOUNT_2',
  'MERCADO_LIVRE_FULFILLMENT_C2',
]);
const FULL_CHANNEL = 'MERCADO_LIVRE_FULFILLMENT_C2';

export const GEFINANCE_PROVIDER_FACTORY = Symbol(
  'GEFINANCE_PROVIDER_FACTORY',
);

export type GeFinanceProviderFactory = (
  reportPath: string,
) => Pick<GeFinanceReportProvider, 'getFinancialEvidence'>;

export type SellerMetricStatus =
  | 'EXACT'
  | 'NEAR'
  | 'DIFFERENT'
  | 'INCOMPATIBLE_SEMANTICS'
  | 'UNAVAILABLE';

export type SellerMetricSource =
  | 'MERCADO_LIVRE_OFFICIAL'
  | 'OLIST_TINY_V3'
  | 'GEFINANCE_XLSX';

export interface SellerMetricEvidence {
  metric: string;
  source: SellerMetricSource;
  value: string | number | null;
  semantic: string;
  status: SellerMetricStatus;
  comparisonSource: SellerMetricSource | null;
  absoluteDifference: string | null;
  percentageDifference: string | null;
  notes: string;
}

export type MatchingStatus =
  | 'MATCHED_EXACT'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'CONFLICT';

interface MatchingCounts {
  MATCHED_EXACT: number;
  AMBIGUOUS: number;
  UNMATCHED: number;
  CONFLICT: number;
}

export interface SellerMetricsReconciliationParams {
  marketplaceAccountId: string;
  olistAccountId: string;
  date: string;
  geFinanceReportPath: string;
  geFinanceProvider?: FinancialEvidenceProvider;
}

export interface SellerMetricsReconciliationReport {
  mode: 'READ_ONLY';
  persistence: 'DISABLED';
  date: string;
  timeZone: string;
  comparisonPolicy: {
    reference: 'MERCADO_LIVRE_WHEN_SEMANTICALLY_COMPATIBLE';
    nearTolerance: null;
    nearStatusUsed: false;
    averagingAcrossSources: false;
  };
  accountIsolation: {
    marketplace: 'EXACT_ID';
    olist: 'EXACT_ID';
    geFinance: 'ACCOUNT_2_CHANNEL_ALLOWLIST';
    excludedGeFinanceRecords: number;
  };
  general: SellerMetricEvidence[];
  full: {
    primaryClassification: 'ML shipment.logistic_type = fulfillment';
    evidence: SellerMetricEvidence[];
  };
  geFinanceMargin: {
    formula: 'SUM(Margem) / SUM(Total prod. vendidos)';
    generalRate: string | null;
    fullRate: string | null;
  };
  matching: {
    identifiersExposed: false;
    mlOlist: MatchingCounts & { totalOlistOrders: number };
    threeSources: MatchingCounts & {
      geFinanceRecords: number;
      distinctGeFinanceReferences: number;
      method: 'GeFinance Número E-commerce -> ML order/pack -> Olist';
    };
  };
  metricsWithoutEquivalentSource: string[];
  reliableCandidateSources: Array<{
    metric: string;
    sources: SellerMetricSource[];
  }>;
}

export type SellerMetricsReconciliationResult =
  SellerMetricsReconciliationReport;

interface Candidate {
  source: SellerMetricSource;
  value: Prisma.Decimal | null;
  serializedValue: string | number | null;
  semantic: string;
  notes: string;
  incompatible?: boolean;
}

@Injectable()
export class SellerMetricsReconciliationService {
  constructor(
    private readonly olistInspection: OlistOrdersInspectionService,
    private readonly mercadoLivreClient: MercadoLivreClient,
    @Inject(GEFINANCE_PROVIDER_FACTORY)
    private readonly geFinanceProviderFactory: GeFinanceProviderFactory,
  ) {}

  async reconcile(
    params: SellerMetricsReconciliationParams,
  ): Promise<SellerMetricsReconciliationReport> {
    const inspection = await this.olistInspection.inspect({
      marketplaceAccountId: params.marketplaceAccountId,
      olistAccountId: params.olistAccountId,
      date: params.date,
    });
    const geFinanceProvider =
      params.geFinanceProvider ??
      this.geFinanceProviderFactory(params.geFinanceReportPath);
    const unfilteredFinancial = await geFinanceProvider.getFinancialEvidence({
      date: params.date,
    });
    const financial = filterAccount2FinancialEvidence(unfilteredFinancial);
    const fullFinancial = filterFullFinancialEvidence(financial);
    const financialSummary = summarizeFinancialEvidence(financial);
    const fullFinancialSummary = summarizeFinancialEvidence(fullFinancial);
    const visits = await loadVisits(
      this.mercadoLivreClient,
      inspection,
      params.date,
    );

    const mlGross = singleBrlAmount(
      inspection.mercadoLivre.orderAmountByCurrency,
    );
    const mlFullGross = singleBrlAmount(
      inspection.full.officialMlClassification.orderAmountByCurrency,
    );
    const olistProducts = completeOlistProductTotal(inspection.olist);
    const olistFullProducts = completeOlistProductTotal(
      inspection.full.olistChannel,
    );
    const fullMlAvailable =
      inspection.full.officialMlClassification.classificationErrors === 0;

    const general = [
      ...compareCandidates('salesCount', [
        countCandidate(
          'MERCADO_LIVRE_OFFICIAL',
          inspection.mercadoLivre.ordersCount,
          'COUNT(official ML orders created in the local day)',
          'Fonte operacional oficial usada como referência desta comparação.',
        ),
        countCandidate(
          'OLIST_TINY_V3',
          inspection.olist.ordersCount,
          'COUNT(Olist orders in the Account 2 channel allowlist)',
          'Pedidos Olist filtrados para ML_ALEIMMPORTS 2 e Mercado Livre Fulfillment.',
        ),
        incompatibleCandidate(
          'GEFINANCE_XLSX',
          financial.records.length,
          'COUNT(filtered financial records)',
          'Contagem exibida somente como evidência financeira filtrada; não promovida a quantidade de vendas.',
        ),
      ]),
      ...compareCandidates('unitsSold', [
        countCandidate(
          'MERCADO_LIVRE_OFFICIAL',
          inspection.mercadoLivre.units,
          'SUM(ML order_items.quantity)',
          'Unidades comerciais da fonte oficial do marketplace.',
        ),
        incompatibleCandidate(
          'OLIST_TINY_V3',
          null,
          'Olist item.quantidade (excluded from commercial units)',
          'item.quantidade não é usada como unidade comercial por não haver evidência de expansão de kits.',
        ),
        unavailableCandidate(
          'GEFINANCE_XLSX',
          'O relatório permitido não fornece uma coluna de unidades comerciais.',
        ),
      ]),
      ...compareCandidates('grossSales', [
        moneyCandidate(
          'MERCADO_LIVRE_OFFICIAL',
          mlGross,
          'SUM(ML order.total_amount), BRL',
          mlGross === null
            ? 'Indisponível porque a soma não pôde ser isolada em BRL.'
            : 'Candidato operacional oficial usado como referência da comparação.',
        ),
        moneyCandidate(
          'OLIST_TINY_V3',
          olistProducts,
          'SUM(Olist valorTotalProdutos / totalProdutos)',
          olistProducts === null
            ? 'Indisponível porque totalProdutos não cobre todos os pedidos filtrados.'
            : 'Componente de produtos informado diretamente pela Olist.',
        ),
        decimalCandidate(
          'GEFINANCE_XLSX',
          financialSummary.totals.totalProductsSoldAmount,
          'SUM(GeFinance Total prod. vendidos)',
          'Componente financeiro compatível; não é ajustado para coincidir com outra fonte.',
          2,
        ),
        decimalCandidate(
          'GEFINANCE_XLSX',
          financialSummary.totals.productSoldAmount,
          'SUM(GeFinance Valor do produto vendido)',
          'Componente financeiro adicional exibido sem ajuste entre fontes.',
          2,
        ),
        decimalCandidate(
          'GEFINANCE_XLSX',
          financialSummary.totals.totalSaleAmount,
          'SUM(GeFinance Total venda)',
          'Componente financeiro adicional; pode incluir composição diferente de produtos.',
          2,
        ),
      ]),
      ...compareCandidates('marginRate', [
        unavailableCandidate(
          'MERCADO_LIVRE_OFFICIAL',
          'ML orders não fornecem os componentes de margem GeFinance.',
        ),
        unavailableCandidate(
          'OLIST_TINY_V3',
          'O contrato inspecionado não fornece os componentes de margem GeFinance.',
        ),
        rateCandidate(
          'GEFINANCE_XLSX',
          financialSummary.aggregateMargin.rate,
          'SUM(Margem) / SUM(Total prod. vendidos)',
          'Taxa agregada por somas; percentuais de linha não são promediados.',
        ),
      ], 'GEFINANCE_XLSX'),
      ...compareCandidates('visits', [
        visits.error === null
          ? countCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              visits.value!,
              'ML official user visits for the requested day',
              'Consulta ao endpoint oficial de visitas.',
            )
          : unavailableCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              visits.error,
            ),
        unavailableCandidate(
          'OLIST_TINY_V3',
          'Olist orders não possui fonte equivalente de visitas.',
        ),
        unavailableCandidate(
          'GEFINANCE_XLSX',
          'O relatório financeiro não possui fonte equivalente de visitas.',
        ),
      ]),
      ...compareCandidates('averageTicketCandidate', [
        derivedAverageCandidate(
          'MERCADO_LIVRE_OFFICIAL',
          mlGross,
          inspection.mercadoLivre.ordersCount,
          'SUM(order.total_amount) / COUNT(orders)',
        ),
        derivedAverageCandidate(
          'OLIST_TINY_V3',
          olistProducts,
          inspection.olist.ordersCount,
          'SUM(totalProdutos) / COUNT(orders)',
        ),
        unavailableCandidate(
          'GEFINANCE_XLSX',
          'Sem candidato canônico: registros financeiros não são promovidos a vendas.',
        ),
      ]),
    ];

    const full = [
      ...compareCandidates('salesCount', [
        fullMlAvailable
          ? countCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              inspection.full.officialMlClassification.ordersCount,
              'COUNT(ML orders with shipment.logistic_type=fulfillment)',
              'Classificação operacional primária.',
            )
          : unavailableCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              'Uma ou mais classificações de shipment falharam; o total parcial foi descartado.',
            ),
        countCandidate(
          'OLIST_TINY_V3',
          inspection.full.olistChannel.ordersCount,
          'COUNT(Olist channel Mercado Livre Fulfillment)',
          'Evidência do canal Olist, comparada à classificação logística oficial.',
        ),
        incompatibleCandidate(
          'GEFINANCE_XLSX',
          fullFinancial.records.length,
          'COUNT(GeFinance channel Mercado Livre Fulfillment C2 records)',
          'Contagem financeira filtrada; não promovida a quantidade operacional de vendas Full.',
        ),
      ]),
      ...compareCandidates('unitsSold', [
        fullMlAvailable
          ? countCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              inspection.full.officialMlClassification.units,
              'SUM(ML order_items.quantity) for fulfillment shipments',
              'Unidades comerciais Full da fonte oficial.',
            )
          : unavailableCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              'Uma ou mais classificações de shipment falharam; o total parcial foi descartado.',
            ),
        incompatibleCandidate(
          'OLIST_TINY_V3',
          null,
          'Olist item.quantidade (excluded from commercial units)',
          'item.quantidade do canal Full não é usada como unidade comercial.',
        ),
        unavailableCandidate(
          'GEFINANCE_XLSX',
          'O relatório permitido não fornece unidades comerciais Full.',
        ),
      ]),
      ...compareCandidates('grossSales', [
        fullMlAvailable
          ? moneyCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              mlFullGross,
              'SUM(ML order.total_amount) for fulfillment shipments, BRL',
              mlFullGross === null
                ? 'Indisponível porque a soma Full não pôde ser isolada em BRL.'
                : 'Candidato operacional Full oficial.',
            )
          : unavailableCandidate(
              'MERCADO_LIVRE_OFFICIAL',
              'Uma ou mais classificações de shipment falharam; o total parcial foi descartado.',
            ),
        moneyCandidate(
          'OLIST_TINY_V3',
          olistFullProducts,
          'SUM(Olist totalProdutos), channel Mercado Livre Fulfillment',
          olistFullProducts === null
            ? 'Indisponível porque totalProdutos não cobre todos os pedidos Full.'
            : 'Componente de produtos Full informado diretamente pela Olist.',
        ),
        decimalCandidate(
          'GEFINANCE_XLSX',
          fullFinancialSummary.totals.totalProductsSoldAmount,
          'SUM(GeFinance Total prod. vendidos), channel Mercado Livre Fulfillment C2',
          'Componente financeiro Full compatível.',
          2,
        ),
        decimalCandidate(
          'GEFINANCE_XLSX',
          fullFinancialSummary.totals.productSoldAmount,
          'SUM(GeFinance Valor do produto vendido), channel Mercado Livre Fulfillment C2',
          'Componente financeiro Full adicional exibido sem ajuste entre fontes.',
          2,
        ),
        decimalCandidate(
          'GEFINANCE_XLSX',
          fullFinancialSummary.totals.totalSaleAmount,
          'SUM(GeFinance Total venda), channel Mercado Livre Fulfillment C2',
          'Componente financeiro Full adicional; pode ter composição diferente de produtos.',
          2,
        ),
      ]),
      ...compareCandidates('marginRate', [
        unavailableCandidate(
          'MERCADO_LIVRE_OFFICIAL',
          'ML orders não fornecem margem GeFinance Full.',
        ),
        unavailableCandidate(
          'OLIST_TINY_V3',
          'Olist orders não fornece margem GeFinance Full.',
        ),
        rateCandidate(
          'GEFINANCE_XLSX',
          fullFinancialSummary.aggregateMargin.rate,
          'SUM(Margem) / SUM(Total prod. vendidos), channel Mercado Livre Fulfillment C2',
          'Taxa Full calculada somente com componentes GeFinance filtrados.',
        ),
      ], 'GEFINANCE_XLSX'),
    ];

    return {
      mode: 'READ_ONLY',
      persistence: 'DISABLED',
      date: params.date,
      timeZone: inspection.period.timeZone,
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
        excludedGeFinanceRecords:
          unfilteredFinancial.records.length - financial.records.length,
      },
      general,
      full: {
        primaryClassification: 'ML shipment.logistic_type = fulfillment',
        evidence: full,
      },
      geFinanceMargin: {
        formula: 'SUM(Margem) / SUM(Total prod. vendidos)',
        generalRate: serializeRate(financialSummary.aggregateMargin.rate),
        fullRate: serializeRate(fullFinancialSummary.aggregateMargin.rate),
      },
      matching: buildSafeMatching(inspection, financial),
      metricsWithoutEquivalentSource: [
        'general.unitsSold: only ML has accepted commercial-unit semantics',
        'general.marginRate: only GeFinance has the required financial components',
        'general.visits: only ML exposes the official visits candidate',
        'full.unitsSold: only ML has accepted commercial-unit semantics',
        'full.marginRate: only GeFinance has the required financial components',
        'averageTicketCandidate: diagnostic candidates only; no canonical metric',
      ],
      reliableCandidateSources: buildReliableCandidates(
        general,
        full,
      ),
    };
  }
}

function filterAccount2FinancialEvidence(
  report: FinancialEvidenceReport,
): FinancialEvidenceReport {
  return {
    ...report,
    records: report.records.filter((record) =>
      ACCOUNT_2_CHANNELS.has(record.channel.normalized),
    ),
  };
}

function filterFullFinancialEvidence(
  report: FinancialEvidenceReport,
): FinancialEvidenceReport {
  return {
    ...report,
    records: report.records.filter(
      (record) => record.channel.normalized === FULL_CHANNEL,
    ),
  };
}

function countCandidate(
  source: SellerMetricSource,
  value: number,
  semantic: string,
  notes: string,
): Candidate {
  return {
    source,
    value: new Prisma.Decimal(value),
    serializedValue: value,
    semantic,
    notes,
  };
}

function moneyCandidate(
  source: SellerMetricSource,
  value: string | null,
  semantic: string,
  notes: string,
): Candidate {
  return value === null
    ? unavailableCandidate(source, notes, semantic)
    : decimalCandidate(source, new Prisma.Decimal(value), semantic, notes, 2);
}

function decimalCandidate(
  source: SellerMetricSource,
  value: Prisma.Decimal,
  semantic: string,
  notes: string,
  scale: number,
): Candidate {
  return {
    source,
    value,
    serializedValue: value.toFixed(scale),
    semantic,
    notes,
  };
}

function rateCandidate(
  source: SellerMetricSource,
  value: Prisma.Decimal | null,
  semantic: string,
  notes: string,
): Candidate {
  return value === null
    ? unavailableCandidate(
        source,
        `${notes} Denominador igual a zero.`,
        semantic,
      )
    : {
        source,
        value: value.mul(100),
        serializedValue: serializeRate(value),
        semantic,
        notes: `${notes} Valor expresso em percentual.`,
      };
}

function derivedAverageCandidate(
  source: SellerMetricSource,
  gross: string | null,
  count: number,
  semantic: string,
): Candidate {
  if (gross === null || count === 0) {
    return unavailableCandidate(
      source,
      'Candidato indisponível porque não há valor bruto completo ou a contagem é zero.',
      semantic,
    );
  }
  const value = new Prisma.Decimal(gross).dividedBy(count);
  return {
    source,
    value,
    serializedValue: value.toFixed(2),
    semantic,
    notes:
      'Candidato derivado dentro da própria fonte, arredondado a 2 casas; não é métrica canônica e não mistura fontes.',
  };
}

function incompatibleCandidate(
  source: SellerMetricSource,
  displayedValue: string | number | null,
  semantic: string,
  notes: string,
): Candidate {
  return {
    source,
    value: null,
    serializedValue: displayedValue,
    semantic,
    notes,
    incompatible: true,
  };
}

function unavailableCandidate(
  source: SellerMetricSource,
  notes: string,
  semantic = 'NO_EQUIVALENT_AVAILABLE',
): Candidate {
  return {
    source,
    value: null,
    serializedValue: null,
    semantic,
    notes,
  };
}

function compareCandidates(
  metric: string,
  candidates: Candidate[],
  preferredReference: SellerMetricSource = 'MERCADO_LIVRE_OFFICIAL',
): SellerMetricEvidence[] {
  const reference =
    candidates.find(
      (candidate) =>
        candidate.source === preferredReference &&
        candidate.value !== null &&
        !candidate.incompatible,
    ) ??
    candidates.find(
      (candidate) => candidate.value !== null && !candidate.incompatible,
    );

  return candidates.map((candidate) => {
    if (candidate.incompatible) {
      return evidence(
        metric,
        candidate,
        'INCOMPATIBLE_SEMANTICS',
        null,
        null,
        null,
      );
    }
    if (candidate.value === null || !reference?.value) {
      return evidence(metric, candidate, 'UNAVAILABLE', null, null, null);
    }
    const difference = candidate.value.minus(reference.value).abs();
    const percentage = reference.value.isZero()
      ? null
      : difference.dividedBy(reference.value.abs()).mul(100);
    return evidence(
      metric,
      candidate,
      difference.isZero() ? 'EXACT' : 'DIFFERENT',
      decimalDifference(difference),
      percentage === null ? null : percentage.toFixed(4),
      reference.source,
    );
  });
}

function evidence(
  metric: string,
  candidate: Candidate,
  status: SellerMetricStatus,
  absoluteDifference: string | null,
  percentageDifference: string | null,
  comparisonSource: SellerMetricSource | null,
): SellerMetricEvidence {
  return {
    metric,
    source: candidate.source,
    value: candidate.serializedValue,
    semantic: candidate.semantic,
    status,
    comparisonSource,
    absoluteDifference,
    percentageDifference,
    notes: candidate.notes,
  };
}

function decimalDifference(value: Prisma.Decimal): string {
  return value.isInteger() ? value.toFixed(0) : value.toString();
}

function singleBrlAmount(
  values: Array<{ currency: string; amount: string }>,
): string | null {
  return values.length === 1 && values[0]?.currency === 'BRL'
    ? values[0].amount
    : null;
}

function completeOlistProductTotal(values: {
  totalProdutos: string | null;
  totalProdutosCoverage: { missingOrders: number };
}): string | null {
  return values.totalProdutosCoverage.missingOrders === 0
    ? values.totalProdutos
    : null;
}

async function loadVisits(
  client: MercadoLivreClient,
  inspection: OlistOrdersInspectionReport,
  date: string,
): Promise<{ value: number | null; error: string | null }> {
  try {
    const result = await client.getUserVisits(
      inspection.accounts.correlation.marketplaceAccount.sellerId,
      date,
      nextCalendarDate(date),
      { id: inspection.accounts.correlation.marketplaceAccount.id },
    );
    return { value: result.total_visits, error: null };
  } catch (error: unknown) {
    if (error instanceof MercadoLivreClientError) {
      const availability =
        error.statusCode === 401 || error.statusCode === 403
          ? 'ACCESS_DENIED'
          : 'UNAVAILABLE';
      return {
        value: null,
        error: `${availability}: official ML visits (${error.code}).`,
      };
    }
    throw error;
  }
}

function nextCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1))
    .toISOString()
    .slice(0, 10);
}

function serializeRate(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.mul(100).toDecimalPlaces(10).toString();
}

function emptyMatchingCounts(): MatchingCounts {
  return {
    MATCHED_EXACT: 0,
    AMBIGUOUS: 0,
    UNMATCHED: 0,
    CONFLICT: 0,
  };
}

function buildSafeMatching(
  inspection: OlistOrdersInspectionReport,
  financial: FinancialEvidenceReport,
): SellerMetricsReconciliationReport['matching'] {
  const mlOlist: MatchingCounts & { totalOlistOrders: number } = {
    MATCHED_EXACT: inspection.matching.matchedExact,
    AMBIGUOUS: inspection.matching.ambiguous,
    UNMATCHED: inspection.matching.unmatched,
    CONFLICT: inspection.matching.conflict,
    totalOlistOrders: inspection.matching.rows.length,
  };
  const byReference = new Map<
    string,
    OlistOrdersInspectionReport['matching']['rows']
  >();
  for (const row of inspection.matching.rows) {
    for (const identifier of [...row.mlOrderIds, ...row.mlPackIds]) {
      const bucket = byReference.get(identifier) ?? [];
      bucket.push(row);
      byReference.set(identifier, bucket);
    }
  }

  const statuses = emptyMatchingCounts();
  const references = new Set(
    financial.records.map((record) => record.orderReference),
  );
  for (const reference of references) {
    statuses[classifyFinancialReference(byReference.get(reference) ?? [])] += 1;
  }

  return {
    identifiersExposed: false,
    mlOlist,
    threeSources: {
      ...statuses,
      geFinanceRecords: financial.records.length,
      distinctGeFinanceReferences: references.size,
      method: 'GeFinance Número E-commerce -> ML order/pack -> Olist',
    },
  };
}

function classifyFinancialReference(
  rows: OlistOrdersInspectionReport['matching']['rows'],
): MatchingStatus {
  if (rows.length === 0) {
    return 'UNMATCHED';
  }
  if (rows.some((row) => row.status === 'CONFLICT')) {
    return 'CONFLICT';
  }
  const uniqueOlistOrders = new Set(rows.map((row) => row.olistOrderId));
  if (
    uniqueOlistOrders.size > 1 ||
    rows.some((row) => row.status === 'AMBIGUOUS')
  ) {
    return 'AMBIGUOUS';
  }
  return rows.every((row) => row.status === 'MATCHED_EXACT')
    ? 'MATCHED_EXACT'
    : 'UNMATCHED';
}

function buildReliableCandidates(
  general: SellerMetricEvidence[],
  full: SellerMetricEvidence[],
): SellerMetricsReconciliationReport['reliableCandidateSources'] {
  const compatibleSources = (
    rows: SellerMetricEvidence[],
    metric: string,
  ): SellerMetricSource[] => [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.metric === metric &&
            row.status !== 'UNAVAILABLE' &&
            row.status !== 'INCOMPATIBLE_SEMANTICS',
        )
        .map((row) => row.source),
    ),
  ];

  return [
    { metric: 'general.salesCount', sources: compatibleSources(general, 'salesCount') },
    { metric: 'general.unitsSold', sources: compatibleSources(general, 'unitsSold') },
    { metric: 'general.grossSales', sources: compatibleSources(general, 'grossSales') },
    { metric: 'general.marginRate', sources: compatibleSources(general, 'marginRate') },
    { metric: 'general.visits', sources: compatibleSources(general, 'visits') },
    { metric: 'full.salesCount', sources: compatibleSources(full, 'salesCount') },
    { metric: 'full.unitsSold', sources: compatibleSources(full, 'unitsSold') },
    { metric: 'full.grossSales', sources: compatibleSources(full, 'grossSales') },
    { metric: 'full.marginRate', sources: compatibleSources(full, 'marginRate') },
  ];
}

export function createGeFinanceProvider(
  reportPath: string,
): GeFinanceReportProvider {
  return new GeFinanceReportProvider(reportPath);
}
