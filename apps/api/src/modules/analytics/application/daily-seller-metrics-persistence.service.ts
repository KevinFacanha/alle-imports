import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  ResolvedSellerBiMetric,
  ResolvedSellerBiMetrics,
  SellerBiMetricName,
  SellerBiMetricValidationEvidence,
} from './seller-bi-metric.types.js';

export const PERSISTED_SELLER_METRIC_NAMES = [
  'salesCount',
  'unitsSold',
  'grossSales',
  'marginRate',
  'fullSalesCount',
  'fullUnitsSold',
  'fullGrossSales',
  'visits',
  'averageTicket',
  'conversionRate',
] as const satisfies readonly SellerBiMetricName[];

export type PersistedSellerMetricName =
  (typeof PERSISTED_SELLER_METRIC_NAMES)[number];

const DATABASE_METRIC_NAMES: Record<PersistedSellerMetricName, string> = {
  salesCount: 'SALES_COUNT',
  unitsSold: 'UNITS_SOLD',
  grossSales: 'GROSS_SALES',
  marginRate: 'MARGIN_RATE',
  fullSalesCount: 'FULL_SALES_COUNT',
  fullUnitsSold: 'FULL_UNITS_SOLD',
  fullGrossSales: 'FULL_GROSS_SALES',
  visits: 'VISITS',
  averageTicket: 'AVERAGE_TICKET',
  conversionRate: 'CONVERSION_RATE',
};

const PERSISTENCE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

export interface DailySellerMetricsExecutionMetadata {
  marketplaceAccountId: string;
  geFinanceReportSha256?: string | null;
  geFinanceDailySha256?: string | null;
  geFinanceMarginAmount?: string | Prisma.Decimal | null;
  geFinanceMarginBaseAmount?: string | Prisma.Decimal | null;
  calculatedAt?: Date;
}

export interface DailySellerMetricsPersistenceSummary {
  marketplaceAccountId: string;
  businessDate: string;
  timezone: string;
  action: 'CREATED' | 'UPDATED';
  calculatedAt: string;
  geFinanceReportSha256: string | null;
  geFinanceDailySha256: string | null;
  metricCount: number;
  unavailableMetrics: PersistedSellerMetricName[];
}

export class DailySellerMetricsPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySellerMetricsPersistenceError';
  }
}

export interface ExistingDailySellerMetricsSnapshot {
  geFinanceDailySha256: string | null;
}

export interface GeFinanceDailyHashInput {
  businessDate: string;
  sha256: string;
}

export interface GeFinanceDailyHashBackfillSummary {
  daysFound: number;
  snapshotsFound: number;
  hashesFilled: number;
  alreadyHashed: number;
  snapshotsMissing: number;
}

export interface GeFinanceLocalMetricRefreshInput {
  marketplaceAccountId: string;
  businessDate: string;
  geFinanceReportSha256: string;
  geFinanceDailySha256: string;
  marginRate: Prisma.Decimal | null;
  marginAmount: Prisma.Decimal;
  marginBaseAmount: Prisma.Decimal;
  fullGrossSalesEvidenceAmount: Prisma.Decimal;
  calculatedAt?: Date;
}

export interface GeFinanceMarginComponentsBackfillInput {
  marketplaceAccountId: string;
  businessDate: string;
  marginAmount: Prisma.Decimal;
  marginBaseAmount: Prisma.Decimal;
}

export type GeFinanceMarginComponentsBackfillAction =
  | 'ENRICHED'
  | 'UNCHANGED'
  | 'MISSING_SNAPSHOT';

@Injectable()
export class DailySellerMetricsPersistenceService {
  constructor(private readonly database: DatabaseService) {}

  async findExistingSnapshots(params: {
    marketplaceAccountId: string;
    from: string;
    to: string;
  }): Promise<Map<string, ExistingDailySellerMetricsSnapshot>> {
    const snapshots = await this.database.dailySellerMetrics.findMany({
      where: {
        marketplaceAccountId: params.marketplaceAccountId,
        businessDate: {
          gte: parseBusinessDate(params.from),
          lte: parseBusinessDate(params.to),
        },
      },
      select: {
        businessDate: true,
        geFinanceDailySha256: true,
      },
    });

    return new Map(
      snapshots.map(({ businessDate, ...hashes }) => [
        businessDate.toISOString().slice(0, 10),
        hashes,
      ]),
    );
  }

  async backfillGeFinanceDailyHashes(params: {
    marketplaceAccountId: string;
    from: string;
    to: string;
    days: readonly GeFinanceDailyHashInput[];
  }): Promise<GeFinanceDailyHashBackfillSummary> {
    if (!params.marketplaceAccountId || params.days.length === 0) {
      throw new DailySellerMetricsPersistenceError(
        'Marketplace account id and GeFinance daily hashes are required.',
      );
    }
    const hashesByDate = new Map<string, string>();
    for (const day of params.days) {
      parseBusinessDate(day.businessDate);
      if (!/^[a-f0-9]{64}$/i.test(day.sha256)) {
        throw new DailySellerMetricsPersistenceError(
          'GeFinance daily SHA-256 must contain 64 hexadecimal characters.',
        );
      }
      if (hashesByDate.has(day.businessDate)) {
        throw new DailySellerMetricsPersistenceError(
          `Duplicate GeFinance business date: ${day.businessDate}.`,
        );
      }
      hashesByDate.set(day.businessDate, day.sha256);
    }

    const snapshots = await this.database.dailySellerMetrics.findMany({
      where: {
        marketplaceAccountId: params.marketplaceAccountId,
        businessDate: {
          gte: parseBusinessDate(params.from),
          lte: parseBusinessDate(params.to),
        },
      },
      select: {
        id: true,
        businessDate: true,
        geFinanceDailySha256: true,
      },
    });
    const matchingSnapshots = snapshots.filter(({ businessDate }) =>
      hashesByDate.has(businessDate.toISOString().slice(0, 10)),
    );
    const legacy = matchingSnapshots.flatMap((snapshot) => {
      if (snapshot.geFinanceDailySha256 !== null) return [];
      const businessDate = snapshot.businessDate.toISOString().slice(0, 10);
      return [{
        id: snapshot.id,
        sha256: hashesByDate.get(businessDate)!,
      }];
    });

    let hashesFilled = 0;
    if (legacy.length > 0) {
      const values = Prisma.join(
        legacy.map(({ id, sha256 }) =>
          Prisma.sql`(${id}::uuid, ${sha256}::char(64))`,
        ),
      );
      hashesFilled = await this.database.$executeRaw(
        Prisma.sql`
          UPDATE "daily_seller_metrics" AS snapshot
          SET "gefinance_daily_sha256" = input.sha256
          FROM (VALUES ${values}) AS input(id, sha256)
          WHERE snapshot."id" = input.id
            AND snapshot."marketplace_account_id" =
              ${params.marketplaceAccountId}::uuid
            AND snapshot."gefinance_daily_sha256" IS NULL
        `,
      );
    }

    return {
      daysFound: params.days.length,
      snapshotsFound: matchingSnapshots.length,
      hashesFilled,
      alreadyHashed: matchingSnapshots.length - legacy.length,
      snapshotsMissing: params.days.length - matchingSnapshots.length,
    };
  }

  async refreshGeFinanceMetrics(
    params: GeFinanceLocalMetricRefreshInput,
  ): Promise<DailySellerMetricsPersistenceSummary> {
    const businessDate = parseBusinessDate(params.businessDate);
    const calculatedAt = params.calculatedAt ?? new Date();
    validateHash(params.geFinanceReportSha256, 'report');
    validateHash(params.geFinanceDailySha256, 'daily');
    if (!params.marketplaceAccountId || Number.isNaN(calculatedAt.getTime())) {
      throw new DailySellerMetricsPersistenceError(
        'Marketplace account id and calculatedAt are required.',
      );
    }

    return this.database.$transaction(async (transaction) => {
      const snapshot = await transaction.dailySellerMetrics.findUnique({
        where: {
          marketplaceAccountId_businessDate: {
            marketplaceAccountId: params.marketplaceAccountId,
            businessDate,
          },
        },
        select: {
          id: true,
          timezone: true,
          metrics: {
            where: { name: { in: ['MARGIN_RATE', 'FULL_GROSS_SALES'] } },
            select: {
              name: true,
              value: true,
              status: true,
              validationEvidence: true,
            },
          },
        },
      });
      if (!snapshot) {
        throw new DailySellerMetricsPersistenceError(
          'Local GeFinance refresh requires an existing daily snapshot.',
        );
      }
      const marginRow = snapshot.metrics.find(
        ({ name }) => name === 'MARGIN_RATE',
      );
      const fullGrossRow = snapshot.metrics.find(
        ({ name }) => name === 'FULL_GROSS_SALES',
      );
      if (!marginRow || !fullGrossRow) {
        throw new DailySellerMetricsPersistenceError(
          'Local GeFinance refresh requires marginRate and fullGrossSales metrics.',
        );
      }

      const marginMetric = geFinanceMarginMetric(
        params.marginRate,
        params.marginAmount,
        params.marginBaseAmount,
      );
      await transaction.dailySellerMetric.update({
        where: {
          dailySellerMetricsId_name: {
            dailySellerMetricsId: snapshot.id,
            name: 'MARGIN_RATE',
          },
        },
        data: metricData(marginMetric),
      });

      const currentEvidence = Array.isArray(fullGrossRow.validationEvidence)
        ? fullGrossRow.validationEvidence
        : [];
      const refreshedFullEvidence = replaceGeFinanceEvidence(
        currentEvidence,
        fullGrossSalesEvidence(
          params.fullGrossSalesEvidenceAmount,
          fullGrossRow.value,
          fullGrossRow.status,
        ),
      );
      await transaction.dailySellerMetric.update({
        where: {
          dailySellerMetricsId_name: {
            dailySellerMetricsId: snapshot.id,
            name: 'FULL_GROSS_SALES',
          },
        },
        data: { validationEvidence: refreshedFullEvidence },
      });
      await transaction.dailySellerMetrics.update({
        where: { id: snapshot.id },
        data: {
          geFinanceReportSha256: params.geFinanceReportSha256,
          geFinanceDailySha256: params.geFinanceDailySha256,
          calculatedAt,
        },
      });

      return {
        marketplaceAccountId: params.marketplaceAccountId,
        businessDate: params.businessDate,
        timezone: snapshot.timezone,
        action: 'UPDATED' as const,
        calculatedAt: calculatedAt.toISOString(),
        geFinanceReportSha256: params.geFinanceReportSha256,
        geFinanceDailySha256: params.geFinanceDailySha256,
        metricCount: 2,
        unavailableMetrics: params.marginRate === null ? ['marginRate'] : [],
      };
    }, PERSISTENCE_TRANSACTION_OPTIONS);
  }

  async backfillGeFinanceMarginComponents(
    params: GeFinanceMarginComponentsBackfillInput,
  ): Promise<GeFinanceMarginComponentsBackfillAction> {
    const businessDate = parseBusinessDate(params.businessDate);
    if (!params.marketplaceAccountId) {
      throw new DailySellerMetricsPersistenceError(
        'Marketplace account id is required.',
      );
    }

    return this.database.$transaction(async (transaction) => {
      const snapshot = await transaction.dailySellerMetrics.findUnique({
        where: {
          marketplaceAccountId_businessDate: {
            marketplaceAccountId: params.marketplaceAccountId,
            businessDate,
          },
        },
        select: {
          id: true,
          metrics: {
            where: { name: 'MARGIN_RATE' },
            select: { name: true, validationEvidence: true },
          },
        },
      });
      if (!snapshot) return 'MISSING_SNAPSHOT' as const;

      const marginRow = snapshot.metrics[0];
      if (!marginRow) {
        throw new DailySellerMetricsPersistenceError(
          'Margin component backfill requires an existing marginRate metric.',
        );
      }
      const currentEvidence = Array.isArray(marginRow.validationEvidence)
        ? marginRow.validationEvidence
        : [];
      if (
        hasStoredMarginComponents(
          currentEvidence,
          params.marginAmount,
          params.marginBaseAmount,
        )
      ) {
        return 'UNCHANGED' as const;
      }
      const enrichedEvidence = withStoredMarginComponents(
        currentEvidence,
        params.marginAmount,
        params.marginBaseAmount,
      );

      await transaction.dailySellerMetric.update({
        where: {
          dailySellerMetricsId_name: {
            dailySellerMetricsId: snapshot.id,
            name: 'MARGIN_RATE',
          },
        },
        data: { validationEvidence: enrichedEvidence },
      });
      return 'ENRICHED' as const;
    }, PERSISTENCE_TRANSACTION_OPTIONS);
  }

  async persist(
    resolved: ResolvedSellerBiMetrics,
    metadata: DailySellerMetricsExecutionMetadata,
  ): Promise<DailySellerMetricsPersistenceSummary> {
    const businessDate = parseBusinessDate(resolved.date);
    const calculatedAt = metadata.calculatedAt ?? new Date();
    validateMetadata(resolved, metadata, calculatedAt);

    const metrics = PERSISTED_SELLER_METRIC_NAMES.map((name) => ({
      name,
      data: metricData(
        name === 'marginRate'
          ? withMarginComponents(resolved.metrics[name], metadata)
          : resolved.metrics[name],
      ),
    }));
    const identity = {
      marketplaceAccountId_businessDate: {
        marketplaceAccountId: metadata.marketplaceAccountId,
        businessDate,
      },
    };

    // External reconciliation is complete before this short transaction.
    // Explicit limits tolerate remote pooler latency while keeping the atomic
    // snapshot replacement bounded.
    const action = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.dailySellerMetrics.findUnique({
        where: identity,
        select: { id: true },
      });
      const snapshot = await transaction.dailySellerMetrics.upsert({
        where: identity,
        create: {
          marketplaceAccountId: metadata.marketplaceAccountId,
          businessDate,
          timezone: resolved.timeZone,
          geFinanceReportSha256: metadata.geFinanceReportSha256 ?? null,
          geFinanceDailySha256: metadata.geFinanceDailySha256 ?? null,
          calculatedAt,
        },
        update: {
          timezone: resolved.timeZone,
          geFinanceReportSha256: metadata.geFinanceReportSha256 ?? null,
          geFinanceDailySha256: metadata.geFinanceDailySha256 ?? null,
          calculatedAt,
        },
        select: { id: true },
      });

      await transaction.dailySellerMetric.deleteMany({
        where: { dailySellerMetricsId: snapshot.id },
      });
      await transaction.dailySellerMetric.createMany({
        data: metrics.map(({ name, data }) => ({
          dailySellerMetricsId: snapshot.id,
          name: DATABASE_METRIC_NAMES[name] as Prisma.DailySellerMetricCreateManyInput['name'],
          ...data,
        })),
      });

      return existing ? 'UPDATED' : 'CREATED';
    }, PERSISTENCE_TRANSACTION_OPTIONS);

    return {
      marketplaceAccountId: metadata.marketplaceAccountId,
      businessDate: resolved.date,
      timezone: resolved.timeZone,
      action,
      calculatedAt: calculatedAt.toISOString(),
      geFinanceReportSha256: metadata.geFinanceReportSha256 ?? null,
      geFinanceDailySha256: metadata.geFinanceDailySha256 ?? null,
      metricCount: metrics.length,
      unavailableMetrics: metrics
        .filter(({ data }) => data.status === 'UNAVAILABLE')
        .map(({ name }) => name),
    };
  }
}

function metricData(
  metric: ResolvedSellerBiMetric,
): Omit<
  Prisma.DailySellerMetricCreateManyInput,
  'dailySellerMetricsId' | 'name'
> {
  const unavailable =
    metric.status === 'UNAVAILABLE' ||
    metric.status === 'INCOMPATIBLE_SEMANTICS';

  return {
    value: unavailable ? null : decimalMetricValue(metric),
    source: metric.source,
    status: metric.status,
    confidence: metric.confidence,
    validationEvidence: metric.validationEvidence.map(sanitizeEvidence),
  };
}

function decimalMetricValue(
  metric: ResolvedSellerBiMetric,
): Prisma.Decimal | null {
  if (metric.value === null) return null;
  try {
    return new Prisma.Decimal(metric.value);
  } catch {
    throw new DailySellerMetricsPersistenceError(
      'Resolved seller metric contains a non-numeric value.',
    );
  }
}

function sanitizeEvidence(
  evidence: SellerBiMetricValidationEvidence,
): Prisma.InputJsonObject {
  return {
    metric: evidence.metric,
    source: evidence.source,
    value: safeEvidenceValue(evidence.value),
    ...(evidence.component ? { component: evidence.component } : {}),
    status: evidence.status,
    comparison: evidence.comparison,
    semantic: redactSensitiveText(evidence.semantic),
    absoluteDifference: evidence.absoluteDifference,
    percentageDifference: evidence.percentageDifference,
    notes: redactSensitiveText(evidence.notes),
  };
}

function safeEvidenceValue(
  value: SellerBiMetricValidationEvidence['value'],
): string | number | null {
  if (value === null || typeof value === 'number') return value;
  try {
    return new Prisma.Decimal(value).toString();
  } catch {
    return null;
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED]')
    .replace(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b/g, '[REDACTED]')
    .replace(/\b\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/]?\d{4}[-\s]?\d{2}\b/g, '[REDACTED]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[REDACTED]');
}

function geFinanceMarginMetric(
  rate: Prisma.Decimal | null,
  amount: Prisma.Decimal,
  baseAmount: Prisma.Decimal,
): ResolvedSellerBiMetric {
  const value = rate?.mul(100).toDecimalPlaces(10).toString() ?? null;
  const available = value !== null;
  return {
    value,
    source: 'GEFINANCE',
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    confidence: available ? 'HIGH' : 'LOW',
    validationEvidence: [
      {
        metric: 'marginRate',
        source: 'GEFINANCE',
        value,
        status: available ? 'AVAILABLE' : 'UNAVAILABLE',
        comparison: available ? 'PRIMARY' : 'UNAVAILABLE',
        semantic: 'SUM(Margem) / SUM(Total prod. vendidos)',
        absoluteDifference: null,
        percentageDifference: null,
        notes: available
          ? 'Taxa agregada por somas; percentuais de linha não são promediados. Valor expresso em percentual.'
          : 'Taxa agregada indisponível porque o denominador é zero.',
      },
      marginComponentEvidence('MARGIN_AMOUNT', amount),
      marginComponentEvidence('MARGIN_BASE_AMOUNT', baseAmount),
    ],
    notes: [
      'Calculada por razão de somas; percentuais de linha não são promediados.',
    ],
  };
}

function withMarginComponents(
  metric: ResolvedSellerBiMetric,
  metadata: DailySellerMetricsExecutionMetadata,
): ResolvedSellerBiMetric {
  const amount = optionalDecimal(metadata.geFinanceMarginAmount);
  const baseAmount = optionalDecimal(metadata.geFinanceMarginBaseAmount);
  if (amount === null || baseAmount === null) return metric;

  return {
    ...metric,
    validationEvidence: [
      ...metric.validationEvidence.filter(({ component }) => !component),
      marginComponentEvidence('MARGIN_AMOUNT', amount),
      marginComponentEvidence('MARGIN_BASE_AMOUNT', baseAmount),
    ],
  };
}

function marginComponentEvidence(
  component: 'MARGIN_AMOUNT' | 'MARGIN_BASE_AMOUNT',
  value: Prisma.Decimal,
): SellerBiMetricValidationEvidence {
  return {
    metric: 'marginRate',
    source: 'GEFINANCE',
    value: value.toString(),
    component,
    status: 'AVAILABLE',
    comparison: 'PRIMARY',
    semantic:
      component === 'MARGIN_AMOUNT'
        ? 'SUM(Margem)'
        : 'SUM(Total prod. vendidos)',
    absoluteDifference: null,
    percentageDifference: null,
    notes: 'Componente exato persistido para agregação temporal da margem.',
  };
}

function hasStoredMarginComponents(
  current: Prisma.JsonArray,
  marginAmount: Prisma.Decimal,
  marginBaseAmount: Prisma.Decimal,
): boolean {
  const expected = new Map([
    ['MARGIN_AMOUNT', marginAmount],
    ['MARGIN_BASE_AMOUNT', marginBaseAmount],
  ]);
  const found = new Set<string>();
  for (const entry of current) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    if (entry.component !== 'MARGIN_AMOUNT' && entry.component !== 'MARGIN_BASE_AMOUNT') {
      continue;
    }
    if (
      found.has(entry.component) ||
      entry.source !== 'GEFINANCE' ||
      entry.status !== 'AVAILABLE' ||
      (typeof entry.value !== 'string' && typeof entry.value !== 'number')
    ) {
      return false;
    }
    try {
      if (!new Prisma.Decimal(entry.value).equals(expected.get(entry.component)!)) {
        return false;
      }
    } catch {
      return false;
    }
    found.add(entry.component);
  }
  return found.size === expected.size;
}

function withStoredMarginComponents(
  current: Prisma.JsonArray,
  marginAmount: Prisma.Decimal,
  marginBaseAmount: Prisma.Decimal,
): Prisma.InputJsonArray {
  const withoutMarginComponents = current.filter((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return true;
    }
    return (
      entry.component !== 'MARGIN_AMOUNT' &&
      entry.component !== 'MARGIN_BASE_AMOUNT'
    );
  });
  return [
    ...(withoutMarginComponents as Prisma.InputJsonValue[]),
    sanitizeEvidence(marginComponentEvidence('MARGIN_AMOUNT', marginAmount)),
    sanitizeEvidence(
      marginComponentEvidence('MARGIN_BASE_AMOUNT', marginBaseAmount),
    ),
  ] as Prisma.InputJsonArray;
}

function optionalDecimal(
  value: string | Prisma.Decimal | null | undefined,
): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new DailySellerMetricsPersistenceError(
      'GeFinance margin component contains a non-numeric value.',
    );
  }
}

function fullGrossSalesEvidence(
  amount: Prisma.Decimal,
  primaryValue: Prisma.Decimal | null,
  primaryStatus: string,
): SellerBiMetricValidationEvidence {
  const value = amount.toFixed(2);
  const primaryAvailable =
    primaryValue !== null &&
    primaryStatus !== 'UNAVAILABLE' &&
    primaryStatus !== 'INCOMPATIBLE_SEMANTICS';
  const difference =
    primaryAvailable && primaryValue !== null
      ? amount.minus(primaryValue).abs()
      : null;
  const percentage =
    difference === null || primaryValue === null || primaryValue.isZero()
      ? null
      : difference.dividedBy(primaryValue.abs()).mul(100);
  return {
    metric: 'fullGrossSales',
    source: 'GEFINANCE',
    value,
    status: 'AVAILABLE',
    comparison: !primaryAvailable
      ? 'UNAVAILABLE'
      : difference!.isZero()
        ? 'MATCH'
        : 'DIVERGENT',
    semantic:
      'SUM(GeFinance Total prod. vendidos), channel Mercado Livre Fulfillment C2',
    absoluteDifference:
      difference === null ? null : decimalDifference(difference),
    percentageDifference:
      percentage === null ? null : percentage.toFixed(4),
    notes: 'Componente financeiro Full compatível.',
  };
}

function replaceGeFinanceEvidence(
  current: Prisma.JsonArray,
  replacement: SellerBiMetricValidationEvidence,
): Prisma.InputJsonArray {
  const sanitized = sanitizeEvidence(replacement);
  const result: Prisma.InputJsonValue[] = [];
  let replaced = false;
  for (const item of current) {
    if (
      !replaced &&
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      item.source === 'GEFINANCE'
    ) {
      result.push(sanitized);
      replaced = true;
    } else {
      result.push(item as Prisma.InputJsonValue);
    }
  }
  if (!replaced) result.push(sanitized);
  return result as Prisma.InputJsonArray;
}

function decimalDifference(value: Prisma.Decimal): string {
  return value.isInteger() ? value.toFixed(0) : value.toString();
}

function validateHash(value: string, kind: 'report' | 'daily'): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new DailySellerMetricsPersistenceError(
      `GeFinance ${kind} SHA-256 must contain 64 hexadecimal characters.`,
    );
  }
}

function parseBusinessDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DailySellerMetricsPersistenceError(
      'Business date must use YYYY-MM-DD.',
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new DailySellerMetricsPersistenceError('Business date is invalid.');
  }
  return date;
}

function validateMetadata(
  resolved: ResolvedSellerBiMetrics,
  metadata: DailySellerMetricsExecutionMetadata,
  calculatedAt: Date,
): void {
  if (!metadata.marketplaceAccountId) {
    throw new DailySellerMetricsPersistenceError(
      'Marketplace account id is required.',
    );
  }
  if (!resolved.timeZone || Number.isNaN(calculatedAt.getTime())) {
    throw new DailySellerMetricsPersistenceError(
      'Timezone and calculatedAt must be valid.',
    );
  }
  if (
    metadata.geFinanceReportSha256 !== undefined &&
    metadata.geFinanceReportSha256 !== null &&
    !/^[a-f0-9]{64}$/i.test(metadata.geFinanceReportSha256)
  ) {
    throw new DailySellerMetricsPersistenceError(
      'GeFinance report SHA-256 must contain 64 hexadecimal characters.',
    );
  }
  if (
    metadata.geFinanceDailySha256 !== undefined &&
    metadata.geFinanceDailySha256 !== null &&
    !/^[a-f0-9]{64}$/i.test(metadata.geFinanceDailySha256)
  ) {
    throw new DailySellerMetricsPersistenceError(
      'GeFinance daily SHA-256 must contain 64 hexadecimal characters.',
    );
  }
}
