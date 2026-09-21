import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  PERSISTED_SELLER_METRIC_NAMES,
  PersistedSellerMetricName,
} from './daily-seller-metrics-persistence.service.js';

export const MAX_SELLER_METRICS_RANGE_DAYS = 31;

const API_METRIC_NAMES = {
  SALES_COUNT: 'salesCount',
  UNITS_SOLD: 'unitsSold',
  GROSS_SALES: 'grossSales',
  MARGIN_RATE: 'marginRate',
  FULL_SALES_COUNT: 'fullSalesCount',
  FULL_UNITS_SOLD: 'fullUnitsSold',
  FULL_GROSS_SALES: 'fullGrossSales',
  VISITS: 'visits',
  AVERAGE_TICKET: 'averageTicket',
  CONVERSION_RATE: 'conversionRate',
} as const satisfies Record<string, PersistedSellerMetricName>;

const SAFE_EVIDENCE_METRICS = new Set<string>([
  ...PERSISTED_SELLER_METRIC_NAMES,
  'fullClassification',
]);
const SAFE_EVIDENCE_SOURCES = new Set<string>([
  'MERCADO_LIVRE',
  'OLIST',
  'GEFINANCE',
]);
const SAFE_EVIDENCE_STATUSES = new Set<string>([
  'AVAILABLE',
  'UNAVAILABLE',
  'INCOMPATIBLE_SEMANTICS',
  'PROVISIONAL',
]);
const SAFE_EVIDENCE_COMPARISONS = new Set<string>([
  'MATCH',
  'DIVERGENT',
  'NOT_COMPARABLE',
  'UNAVAILABLE',
  'PRIMARY',
]);

export interface SafeValidationEvidence {
  metric: string | null;
  source: string | null;
  value: string | number | null;
  status: string | null;
  comparison: string | null;
  absoluteDifference: string | null;
  percentageDifference: string | null;
}

export interface DailySellerMetricResponse {
  value: string | null;
  source: string;
  status: string;
  confidence: string;
  validationEvidence: SafeValidationEvidence[];
}

export interface DailySellerMetricsResponse {
  marketplaceAccountId: string;
  businessDate: string;
  timezone: string;
  calculatedAt: string;
  metrics: Record<PersistedSellerMetricName, DailySellerMetricResponse>;
}

export interface DailySellerMetricsRangeResponse {
  marketplaceAccountId: string;
  from: string;
  to: string;
  days: DailySellerMetricsResponse[];
}

const snapshotSelection = Prisma.validator<Prisma.DailySellerMetricsSelect>()({
  marketplaceAccountId: true,
  businessDate: true,
  timezone: true,
  calculatedAt: true,
  metrics: {
    select: {
      name: true,
      value: true,
      source: true,
      status: true,
      confidence: true,
      validationEvidence: true,
    },
  },
});

type PersistedSnapshot = Prisma.DailySellerMetricsGetPayload<{
  select: typeof snapshotSelection;
}>;

@Injectable()
export class DailySellerMetricsQueryService {
  constructor(private readonly database: DatabaseService) {}

  async findDaily(
    marketplaceAccountId: string,
    date: string,
  ): Promise<DailySellerMetricsResponse> {
    await this.requireAccount(marketplaceAccountId);
    const businessDate = dateOnly(date);
    const snapshot = await this.database.dailySellerMetrics.findUnique({
      where: {
        marketplaceAccountId_businessDate: {
          marketplaceAccountId,
          businessDate,
        },
      },
      select: snapshotSelection,
    });

    if (!snapshot) {
      throw new NotFoundException('Daily seller metrics snapshot not found.');
    }
    return serializeSnapshot(snapshot);
  }

  async findRange(
    marketplaceAccountId: string,
    from: string,
    to: string,
  ): Promise<DailySellerMetricsRangeResponse> {
    const fromDate = dateOnly(from);
    const toDate = dateOnly(to);
    validateRange(fromDate, toDate);
    await this.requireAccount(marketplaceAccountId);

    const snapshots = await this.database.dailySellerMetrics.findMany({
      where: {
        marketplaceAccountId,
        businessDate: { gte: fromDate, lte: toDate },
      },
      orderBy: { businessDate: 'asc' },
      select: snapshotSelection,
    });

    if (snapshots.length === 0) {
      throw new NotFoundException(
        'No daily seller metrics snapshots found in the requested range.',
      );
    }

    return {
      marketplaceAccountId,
      from,
      to,
      days: snapshots.map(serializeSnapshot),
    };
  }

  private async requireAccount(marketplaceAccountId: string): Promise<void> {
    const account = await this.database.marketplaceAccount.findUnique({
      where: { id: marketplaceAccountId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Marketplace account not found.');
    }
  }
}

function serializeSnapshot(snapshot: PersistedSnapshot): DailySellerMetricsResponse {
  const byName = new Map(
    snapshot.metrics.map((metric) => [API_METRIC_NAMES[metric.name], metric]),
  );
  const metrics = Object.fromEntries(
    PERSISTED_SELLER_METRIC_NAMES.map((name) => {
      const metric = byName.get(name);
      if (!metric) {
        throw new NotFoundException(
          `Daily seller metrics snapshot is incomplete: ${name}.`,
        );
      }
      return [
        name,
        {
          value: metric.value === null ? null : metric.value.toString(),
          source: metric.source,
          status: metric.status,
          confidence: metric.confidence,
          validationEvidence: safeEvidence(metric.validationEvidence),
        },
      ];
    }),
  ) as unknown as Record<PersistedSellerMetricName, DailySellerMetricResponse>;

  return {
    marketplaceAccountId: snapshot.marketplaceAccountId,
    businessDate: snapshot.businessDate.toISOString().slice(0, 10),
    timezone: snapshot.timezone,
    calculatedAt: snapshot.calculatedAt.toISOString(),
    metrics,
  };
}

function safeEvidence(value: Prisma.JsonValue): SafeValidationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    return [
      {
        metric: safeAllowedValue(entry.metric, SAFE_EVIDENCE_METRICS),
        source: safeAllowedValue(entry.source, SAFE_EVIDENCE_SOURCES),
        value: safeEvidenceValue(entry.value),
        status: safeAllowedValue(entry.status, SAFE_EVIDENCE_STATUSES),
        comparison: safeAllowedValue(
          entry.comparison,
          SAFE_EVIDENCE_COMPARISONS,
        ),
        absoluteDifference: safeDecimalText(entry.absoluteDifference),
        percentageDifference: safeDecimalText(entry.percentageDifference),
      },
    ];
  });
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeAllowedValue(
  value: Prisma.JsonValue | undefined,
  allowed: ReadonlySet<string>,
): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function safeEvidenceValue(
  value: Prisma.JsonValue | undefined,
): string | number | null {
  if (value === null || typeof value === 'number') return value;
  return safeDecimalText(value);
}

function safeDecimalText(value: Prisma.JsonValue | undefined): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return new Prisma.Decimal(value).toString();
  } catch {
    return null;
  }
}

function dateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Date must be valid and use YYYY-MM-DD.');
  }
  return parsed;
}

function validateRange(from: Date, to: Date): void {
  const periodDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (periodDays < 1) {
    throw new BadRequestException('from must be earlier than or equal to to.');
  }
  if (periodDays > MAX_SELLER_METRICS_RANGE_DAYS) {
    throw new BadRequestException(
      `Date range cannot exceed ${MAX_SELLER_METRICS_RANGE_DAYS} days.`,
    );
  }
}
