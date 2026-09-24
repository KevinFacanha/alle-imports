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

export interface MarketplaceAccountSummaryResponse {
  id: string;
  name: string;
  marketplace: string;
}

export type ComparisonDayStatus =
  | 'AVAILABLE'
  | 'PARTIAL'
  | 'MISSING_SNAPSHOT';

export type ComparisonMarginRateStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE_COMPONENTS'
  | 'UNAVAILABLE_ZERO_BASE'
  | 'NO_SNAPSHOTS';

export interface SellerMetricsComparisonDayResponse {
  date: string;
  grossSales: string | null;
  marginRate: string | null;
  fullGrossSales: string | null;
  averageTicket: string | null;
  salesCount: string | null;
  fullSalesCount: string | null;
  snapshotAvailable: boolean;
  status: ComparisonDayStatus;
}

export interface SellerMetricsComparisonAccountResponse {
  marketplaceAccountId: string;
  name: string;
  summary: {
    grossSales: string | null;
    fullGrossSales: string | null;
    salesCount: string | null;
    fullSalesCount: string | null;
    averageTicket: string | null;
    marginRate: string | null;
    marginRateStatus: ComparisonMarginRateStatus;
  };
  days: SellerMetricsComparisonDayResponse[];
  availableDays: number;
  missingDays: number;
  expectedDays: number;
}

export interface SellerMetricsComparisonResponse {
  from: string;
  to: string;
  accounts: SellerMetricsComparisonAccountResponse[];
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

  findActiveAccounts(): Promise<MarketplaceAccountSummaryResponse[]> {
    return this.database.marketplaceAccount.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        marketplace: true,
      },
    });
  }

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

  async findComparison(
    accountAId: string,
    accountBId: string,
    from: string,
    to: string,
  ): Promise<SellerMetricsComparisonResponse> {
    const fromDate = dateOnly(from);
    const toDate = dateOnly(to);
    validateRange(fromDate, toDate);
    if (accountAId === accountBId) {
      throw new BadRequestException('accountAId and accountBId must be different.');
    }

    const accountIds = [accountAId, accountBId];
    const accounts = await this.database.marketplaceAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, name: true },
    });
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    if (accountsById.size !== accountIds.length) {
      throw new NotFoundException('Marketplace account not found.');
    }

    const snapshots = await this.database.dailySellerMetrics.findMany({
      where: {
        marketplaceAccountId: { in: accountIds },
        businessDate: { gte: fromDate, lte: toDate },
      },
      orderBy: [
        { marketplaceAccountId: 'asc' },
        { businessDate: 'asc' },
      ],
      select: snapshotSelection,
    });
    const dates = comparisonDates(fromDate, toDate);

    return {
      from,
      to,
      accounts: accountIds.map((marketplaceAccountId) => {
        const account = accountsById.get(marketplaceAccountId)!;
        return serializeComparisonAccount(
          account,
          snapshots.filter(
            (snapshot) =>
              snapshot.marketplaceAccountId === marketplaceAccountId,
          ),
          dates,
        );
      }),
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

type ComparisonMetricName =
  | 'GROSS_SALES'
  | 'MARGIN_RATE'
  | 'FULL_GROSS_SALES'
  | 'AVERAGE_TICKET'
  | 'SALES_COUNT'
  | 'FULL_SALES_COUNT';

function serializeComparisonAccount(
  account: { id: string; name: string },
  snapshots: PersistedSnapshot[],
  dates: string[],
): SellerMetricsComparisonAccountResponse {
  const snapshotsByDate = new Map(
    snapshots.map((snapshot) => [
      snapshot.businessDate.toISOString().slice(0, 10),
      snapshot,
    ]),
  );
  const days = dates.map((date) => {
    const snapshot = snapshotsByDate.get(date);
    if (!snapshot) {
      return {
        date,
        grossSales: null,
        marginRate: null,
        fullGrossSales: null,
        averageTicket: null,
        salesCount: null,
        fullSalesCount: null,
        snapshotAvailable: false,
        status: 'MISSING_SNAPSHOT' as const,
      };
    }
    const values = {
      grossSales: comparisonMetricValue(snapshot, 'GROSS_SALES'),
      marginRate: comparisonMetricValue(snapshot, 'MARGIN_RATE'),
      fullGrossSales: comparisonMetricValue(snapshot, 'FULL_GROSS_SALES'),
      averageTicket: comparisonMetricValue(snapshot, 'AVERAGE_TICKET'),
      salesCount: comparisonMetricValue(snapshot, 'SALES_COUNT'),
      fullSalesCount: comparisonMetricValue(snapshot, 'FULL_SALES_COUNT'),
    };
    return {
      date,
      ...values,
      snapshotAvailable: true,
      status: Object.values(values).every((value) => value !== null)
        ? ('AVAILABLE' as const)
        : ('PARTIAL' as const),
    };
  });

  const grossSales = sumComparisonMetric(snapshots, 'GROSS_SALES');
  const salesCount = sumComparisonMetric(snapshots, 'SALES_COUNT');
  const margin = aggregateMargin(snapshots);
  return {
    marketplaceAccountId: account.id,
    name: account.name,
    summary: {
      grossSales: decimalText(grossSales),
      fullGrossSales: decimalText(
        sumComparisonMetric(snapshots, 'FULL_GROSS_SALES'),
      ),
      salesCount: decimalText(salesCount),
      fullSalesCount: decimalText(
        sumComparisonMetric(snapshots, 'FULL_SALES_COUNT'),
      ),
      averageTicket:
        grossSales === null || salesCount === null || salesCount.isZero()
          ? null
          : grossSales.dividedBy(salesCount).toString(),
      marginRate: margin.value,
      marginRateStatus: margin.status,
    },
    days,
    availableDays: snapshots.length,
    missingDays: dates.length - snapshots.length,
    expectedDays: dates.length,
  };
}

function comparisonMetricValue(
  snapshot: PersistedSnapshot,
  name: ComparisonMetricName,
): string | null {
  const metric = snapshot.metrics.find((candidate) => candidate.name === name);
  return metric?.value === null || metric?.value === undefined
    ? null
    : metric.value.toString();
}

function sumComparisonMetric(
  snapshots: PersistedSnapshot[],
  name: ComparisonMetricName,
): Prisma.Decimal | null {
  const values = snapshots.flatMap((snapshot) => {
    const value = comparisonMetricValue(snapshot, name);
    return value === null ? [] : [new Prisma.Decimal(value)];
  });
  if (values.length === 0) return null;
  return values.reduce(
    (sum, value) => sum.plus(value),
    new Prisma.Decimal(0),
  );
}

function aggregateMargin(snapshots: PersistedSnapshot[]): {
  value: string | null;
  status: ComparisonMarginRateStatus;
} {
  if (snapshots.length === 0) return { value: null, status: 'NO_SNAPSHOTS' };

  let amount = new Prisma.Decimal(0);
  let baseAmount = new Prisma.Decimal(0);
  for (const snapshot of snapshots) {
    const metric = snapshot.metrics.find(
      (candidate) => candidate.name === 'MARGIN_RATE',
    );
    const components = marginComponents(metric?.validationEvidence);
    if (!components) {
      return { value: null, status: 'UNAVAILABLE_COMPONENTS' };
    }
    amount = amount.plus(components.amount);
    baseAmount = baseAmount.plus(components.baseAmount);
  }
  if (baseAmount.isZero()) {
    return { value: null, status: 'UNAVAILABLE_ZERO_BASE' };
  }
  return {
    value: amount
      .dividedBy(baseAmount)
      .mul(100)
      .toDecimalPlaces(10)
      .toString(),
    status: 'AVAILABLE',
  };
}

function marginComponents(value: Prisma.JsonValue | undefined): {
  amount: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
} | null {
  if (!Array.isArray(value)) return null;
  const amounts = value.flatMap((entry) =>
    marginComponent(entry, 'MARGIN_AMOUNT'),
  );
  const bases = value.flatMap((entry) =>
    marginComponent(entry, 'MARGIN_BASE_AMOUNT'),
  );
  if (amounts.length !== 1 || bases.length !== 1) return null;
  return { amount: amounts[0]!, baseAmount: bases[0]! };
}

function marginComponent(
  entry: Prisma.JsonValue,
  component: 'MARGIN_AMOUNT' | 'MARGIN_BASE_AMOUNT',
): Prisma.Decimal[] {
  if (
    !isJsonObject(entry) ||
    entry.component !== component ||
    entry.source !== 'GEFINANCE' ||
    entry.status !== 'AVAILABLE' ||
    (typeof entry.value !== 'string' && typeof entry.value !== 'number')
  ) {
    return [];
  }
  try {
    return [new Prisma.Decimal(entry.value)];
  } catch {
    return [];
  }
}

function decimalText(value: Prisma.Decimal | null): string | null {
  return value?.toString() ?? null;
}

function comparisonDates(from: Date, to: Date): string[] {
  const dates: string[] = [];
  for (
    let instant = from.getTime();
    instant <= to.getTime();
    instant += 86_400_000
  ) {
    dates.push(new Date(instant).toISOString().slice(0, 10));
  }
  return dates;
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
