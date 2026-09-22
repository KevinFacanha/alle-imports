import { Prisma } from '@prisma/client';

import {
  SellerMetricEvidence,
  SellerMetricSource,
  SellerMetricsReconciliationResult,
} from './seller-metrics-reconciliation.service.js';
import {
  SellerBiMetricEvidencePolicy,
  SellerBiMetricPolicyDefinition,
  SellerBiMetricSourcePolicy,
} from './seller-bi-metric-source-policy.js';
import {
  ResolvedSellerBiMetric,
  ResolvedSellerBiMetrics,
  SellerBiMetricName,
  SellerBiMetricSource,
  SellerBiMetricStatus,
  SellerBiMetricValidationEvidence,
} from './seller-bi-metric.types.js';

const SOURCE_MAP: Record<
  SellerMetricSource,
  Exclude<SellerBiMetricSource, 'DERIVED'>
> = {
  MERCADO_LIVRE_OFFICIAL: 'MERCADO_LIVRE',
  OLIST_TINY_V3: 'OLIST',
  GEFINANCE_XLSX: 'GEFINANCE',
};

export class SellerBiMetricResolver {
  constructor(
    private readonly policy = new SellerBiMetricSourcePolicy(),
  ) {}

  resolve(
    reconciliation: SellerMetricsReconciliationResult,
  ): ResolvedSellerBiMetrics {
    const salesCount = this.resolveDirect(
      'salesCount',
      reconciliation.general,
    );
    const unitsSold = this.resolveDirect(
      'unitsSold',
      reconciliation.general,
    );
    const grossSales = this.resolveDirect(
      'grossSales',
      reconciliation.general,
    );
    const marginRate = this.resolveDirect(
      'marginRate',
      reconciliation.general,
    );
    const fullSalesCount = this.resolveDirect(
      'fullSalesCount',
      reconciliation.full.evidence,
      'salesCount',
    );
    const fullUnitsSold = this.resolveDirect(
      'fullUnitsSold',
      reconciliation.full.evidence,
      'unitsSold',
    );
    const fullGrossSales = this.resolveDirect(
      'fullGrossSales',
      reconciliation.full.evidence,
      'grossSales',
    );
    const visits = this.resolveDirect('visits', reconciliation.general);
    const averageTicket = this.resolveDerived(
      'averageTicket',
      grossSales,
      salesCount,
      (gross, count) => gross.dividedBy(count).toFixed(2),
    );
    const conversionRate = this.resolveDerived(
      'conversionRate',
      salesCount,
      visits,
      (sales, visitCount) =>
        sales.mul(100).dividedBy(visitCount).toDecimalPlaces(10).toString(),
    );
    const fullClassificationPolicy = this.policy.get('fullClassification');

    return {
      date: reconciliation.date,
      timeZone: reconciliation.timeZone,
      accountIsolation: { ...reconciliation.accountIsolation },
      metrics: {
        salesCount,
        unitsSold,
        grossSales,
        marginRate,
        fullClassification: {
          value: fullClassificationPolicy.primarySemantic,
          source: fullClassificationPolicy.primarySource,
          status: fullClassificationPolicy.resolvedStatus,
          confidence: fullClassificationPolicy.confidence,
          validationEvidence: [],
          notes: [...fullClassificationPolicy.notes],
        },
        fullSalesCount,
        fullUnitsSold,
        fullGrossSales,
        visits,
        averageTicket,
        conversionRate,
      },
    };
  }

  private resolveDirect(
    metric: SellerBiMetricName,
    rows: SellerMetricEvidence[],
    reconciliationMetric: string = metric,
  ): ResolvedSellerBiMetric {
    const definition = this.policy.get(metric);
    const selected = definition.evidence.map((evidencePolicy) => ({
      policy: evidencePolicy,
      row: findEvidence(rows, reconciliationMetric, evidencePolicy),
    }));
    const primary = selected.find(
      ({ policy }) => policy.source === definition.primarySource,
    )?.row;
    const primaryAvailable = isAvailableEvidence(primary);
    const validationEvidence = selected.map(({ policy, row }) =>
      normalizeEvidence(
        metric,
        policy,
        row,
        primaryAvailable ? primary : undefined,
        definition,
      ),
    );

    if (!primaryAvailable) {
      const primaryEvidence = validationEvidence.find(
        (evidence) => evidence.source === definition.primarySource,
      );
      const status: SellerBiMetricStatus =
        primaryEvidence?.status === 'INCOMPATIBLE_SEMANTICS'
          ? 'INCOMPATIBLE_SEMANTICS'
          : 'UNAVAILABLE';
      return {
        value: null,
        source: definition.primarySource,
        status,
        confidence: 'LOW',
        validationEvidence,
        notes: [
          ...definition.notes,
          'A fonte primária está indisponível; fontes de validação não são usadas como fallback.',
          ...(primary?.notes ? [primary.notes] : []),
        ],
      };
    }

    return {
      value: primary.value,
      source: definition.primarySource,
      status: definition.resolvedStatus,
      confidence: definition.confidence,
      validationEvidence,
      notes: [...definition.notes],
    };
  }

  private resolveDerived(
    metric: Extract<SellerBiMetricName, 'averageTicket' | 'conversionRate'>,
    numerator: ResolvedSellerBiMetric,
    denominator: ResolvedSellerBiMetric,
    calculate: (numerator: Prisma.Decimal, denominator: Prisma.Decimal) => string,
  ): ResolvedSellerBiMetric {
    const definition = this.policy.get(metric);
    const validationEvidence = [
      ...numerator.validationEvidence,
      ...denominator.validationEvidence,
    ];
    const numeratorValue = metricDecimal(numerator);
    const denominatorValue = metricDecimal(denominator);

    if (
      numeratorValue === null ||
      denominatorValue === null ||
      denominatorValue.isZero()
    ) {
      return {
        value: null,
        source: 'DERIVED',
        status: 'UNAVAILABLE',
        confidence: 'LOW',
        validationEvidence,
        notes: [
          ...definition.notes,
          'Um operando resolvido está indisponível ou o denominador é zero.',
        ],
      };
    }

    const dependencyIsProvisional =
      numerator.status === 'PROVISIONAL' ||
      denominator.status === 'PROVISIONAL';
    return {
      value: calculate(numeratorValue, denominatorValue),
      source: 'DERIVED',
      status: dependencyIsProvisional
        ? 'PROVISIONAL'
        : definition.resolvedStatus,
      confidence: dependencyIsProvisional ? 'MEDIUM' : definition.confidence,
      validationEvidence,
      notes: [...definition.notes],
    };
  }
}

function findEvidence(
  rows: SellerMetricEvidence[],
  metric: string,
  policy: SellerBiMetricEvidencePolicy,
): SellerMetricEvidence | undefined {
  const sourceRows = rows.filter(
    (row) =>
      row.metric === metric && SOURCE_MAP[row.source] === policy.source,
  );
  return (
    sourceRows.find((row) => row.semantic === policy.semantic) ??
    (sourceRows.length === 1 ? sourceRows[0] : undefined)
  );
}

function isAvailableEvidence(
  evidence: SellerMetricEvidence | undefined,
): evidence is SellerMetricEvidence & { value: string | number } {
  return (
    evidence !== undefined &&
    evidence.value !== null &&
    evidence.status !== 'UNAVAILABLE' &&
    evidence.status !== 'INCOMPATIBLE_SEMANTICS'
  );
}

function normalizeEvidence(
  metric: SellerBiMetricName,
  policy: SellerBiMetricEvidencePolicy,
  evidence: SellerMetricEvidence | undefined,
  primary: (SellerMetricEvidence & { value: string | number }) | undefined,
  definition: SellerBiMetricPolicyDefinition,
): SellerBiMetricValidationEvidence {
  if (!evidence) {
    return {
      metric,
      source: policy.source,
      value: null,
      status: policy.incompatibleSemantics
        ? 'INCOMPATIBLE_SEMANTICS'
        : 'UNAVAILABLE',
      comparison: policy.incompatibleSemantics
        ? 'NOT_COMPARABLE'
        : 'UNAVAILABLE',
      semantic: policy.semantic,
      absoluteDifference: null,
      percentageDifference: null,
      notes: 'A reconciliação não forneceu esta evidência.',
    };
  }

  if (
    policy.incompatibleSemantics ||
    evidence.status === 'INCOMPATIBLE_SEMANTICS'
  ) {
    return {
      metric,
      source: policy.source,
      value: evidence.value,
      status: 'INCOMPATIBLE_SEMANTICS',
      comparison: 'NOT_COMPARABLE',
      semantic: evidence.semantic,
      absoluteDifference: null,
      percentageDifference: null,
      notes: evidence.notes,
    };
  }

  if (!isAvailableEvidence(evidence)) {
    return {
      metric,
      source: policy.source,
      value: evidence.value,
      status: 'UNAVAILABLE',
      comparison: 'UNAVAILABLE',
      semantic: evidence.semantic,
      absoluteDifference: null,
      percentageDifference: null,
      notes: evidence.notes,
    };
  }

  if (!primary) {
    return {
      metric,
      source: policy.source,
      value: evidence.value,
      status: 'AVAILABLE',
      comparison: 'UNAVAILABLE',
      semantic: evidence.semantic,
      absoluteDifference: null,
      percentageDifference: null,
      notes: evidence.notes,
    };
  }

  if (policy.source === definition.primarySource) {
    return {
      metric,
      source: policy.source,
      value: evidence.value,
      status: definition.resolvedStatus,
      comparison: 'PRIMARY',
      semantic: evidence.semantic,
      absoluteDifference: null,
      percentageDifference: null,
      notes: evidence.notes,
    };
  }

  const difference = decimalValue(evidence.value)
    .minus(decimalValue(primary.value))
    .abs();
  const percentage = decimalValue(primary.value).isZero()
    ? null
    : difference.dividedBy(decimalValue(primary.value).abs()).mul(100);
  return {
    metric,
    source: policy.source,
    value: evidence.value,
    status: 'AVAILABLE',
    comparison: difference.isZero() ? 'MATCH' : 'DIVERGENT',
    semantic: evidence.semantic,
    absoluteDifference: decimalDifference(difference),
    percentageDifference:
      percentage === null ? null : percentage.toFixed(4),
    notes: evidence.notes,
  };
}

function metricDecimal(metric: ResolvedSellerBiMetric): Prisma.Decimal | null {
  if (
    metric.value === null ||
    metric.status === 'UNAVAILABLE' ||
    metric.status === 'INCOMPATIBLE_SEMANTICS'
  ) {
    return null;
  }
  return decimalValue(metric.value);
}

function decimalValue(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function decimalDifference(value: Prisma.Decimal): string {
  return value.isInteger() ? value.toFixed(0) : value.toString();
}
