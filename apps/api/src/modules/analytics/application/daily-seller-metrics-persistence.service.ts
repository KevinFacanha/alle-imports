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

  async persist(
    resolved: ResolvedSellerBiMetrics,
    metadata: DailySellerMetricsExecutionMetadata,
  ): Promise<DailySellerMetricsPersistenceSummary> {
    const businessDate = parseBusinessDate(resolved.date);
    const calculatedAt = metadata.calculatedAt ?? new Date();
    validateMetadata(resolved, metadata, calculatedAt);

    const metrics = PERSISTED_SELLER_METRIC_NAMES.map((name) => ({
      name,
      data: metricData(resolved.metrics[name]),
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
