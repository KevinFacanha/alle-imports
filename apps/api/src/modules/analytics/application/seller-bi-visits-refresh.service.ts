import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  MercadoLivreClient,
  MercadoLivreClientError,
} from '../../marketplaces/mercado-livre/mercado-livre.client.js';

const VISITS_SEMANTIC =
  'ML official user visits for the requested calendar date';
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export type SellerBiVisitsRefreshAction =
  | 'WOULD_UPDATE'
  | 'UPDATED'
  | 'UNCHANGED'
  | 'FAILED';

export interface SellerBiVisitsRefreshDay {
  businessDate: string;
  persistedVisits: string | null;
  correctedVisits: number | null;
  delta: string | null;
  salesCount: string | null;
  persistedConversionRate: string | null;
  correctedConversionRate: string | null;
  action: SellerBiVisitsRefreshAction;
  error: string | null;
}

export interface SellerBiVisitsRefreshSummary {
  marketplaceAccountId: string;
  marketplaceAccountName: string;
  from: string;
  to: string;
  apply: boolean;
  days: SellerBiVisitsRefreshDay[];
  updated: number;
  unchanged: number;
  failed: number;
}

export class SellerBiVisitsRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SellerBiVisitsRefreshError';
  }
}

@Injectable()
export class SellerBiVisitsRefreshService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mercadoLivreClient: MercadoLivreClient,
  ) {}

  async refreshRecentClosed(params: {
    marketplaceAccountId: string;
    currentDate: string;
    limit?: number;
    excludeDates?: readonly string[];
  }): Promise<SellerBiVisitsRefreshSummary> {
    parseBusinessDate(params.currentDate);
    const limit = params.limit ?? 7;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new SellerBiVisitsRefreshError('Refresh limit must be a positive integer.');
    }
    const snapshots = await this.database.dailySellerMetrics.findMany({
      where: {
        marketplaceAccountId: params.marketplaceAccountId,
        businessDate: { lt: parseBusinessDate(params.currentDate) },
      },
      orderBy: { businessDate: 'desc' },
      take: limit,
      select: { businessDate: true },
    });
    const excluded = new Set(params.excludeDates ?? []);
    const dates = snapshots
      .map(({ businessDate }) => calendarLabel(businessDate))
      .filter((date) => !excluded.has(date))
      .sort();
    if (dates.length === 0) {
      return this.emptySummary(params.marketplaceAccountId, params.currentDate);
    }
    return this.refreshRange({
      marketplaceAccountId: params.marketplaceAccountId,
      from: dates[0]!,
      to: dates.at(-1)!,
      apply: true,
      dates,
    });
  }

  async refreshRange(params: {
    marketplaceAccountId: string;
    from: string;
    to: string;
    apply?: boolean;
    dates?: readonly string[];
  }): Promise<SellerBiVisitsRefreshSummary> {
    const fromDate = parseBusinessDate(params.from);
    const toDate = parseBusinessDate(params.to);
    if (fromDate > toDate) {
      throw new SellerBiVisitsRefreshError('from must be on or before to.');
    }

    const account = await this.database.marketplaceAccount.findUnique({
      where: { id: params.marketplaceAccountId },
      select: { id: true, name: true, externalAccountId: true },
    });
    if (!account) {
      throw new SellerBiVisitsRefreshError('Marketplace account not found.');
    }

    const snapshots = await this.database.dailySellerMetrics.findMany({
      where: {
        marketplaceAccountId: params.marketplaceAccountId,
        businessDate: { gte: fromDate, lte: toDate },
        ...(params.dates
          ? { businessDate: { in: params.dates.map(parseBusinessDate) } }
          : {}),
      },
      orderBy: { businessDate: 'asc' },
      select: {
        id: true,
        businessDate: true,
        metrics: {
          where: {
            name: { in: ['SALES_COUNT', 'VISITS', 'CONVERSION_RATE'] },
          },
          select: {
            name: true,
            value: true,
            source: true,
            status: true,
            confidence: true,
            validationEvidence: true,
          },
        },
      },
    });

    const days: SellerBiVisitsRefreshDay[] = [];
    for (const snapshot of snapshots) {
      const businessDate = calendarLabel(snapshot.businessDate);
      const byName = new Map(snapshot.metrics.map((metric) => [metric.name, metric]));
      const sales = byName.get('SALES_COUNT');
      const currentVisits = byName.get('VISITS');
      const currentConversion = byName.get('CONVERSION_RATE');
      if (!sales || !currentVisits || !currentConversion || sales.value === null) {
        days.push(failedDay(
          businessDate,
          currentVisits?.value ?? null,
          sales?.value ?? null,
          currentConversion?.value ?? null,
          'Snapshot is missing SALES_COUNT, VISITS or CONVERSION_RATE.',
        ));
        continue;
      }

      try {
        const response = await this.mercadoLivreClient.getUserVisits(
          account.externalAccountId,
          businessDate,
          businessDate,
          { id: account.id },
        );
        const visits = response.total_visits;
        const conversion = conversionRate(sales.value, visits);
        const visitsEvidence = [officialVisitsEvidence(visits, businessDate)];
        const conversionEvidence = [
          ...(Array.isArray(sales.validationEvidence)
            ? sales.validationEvidence
            : []),
          ...visitsEvidence,
        ] as Prisma.InputJsonArray;
        const visitsData = {
          value: new Prisma.Decimal(visits),
          source: 'MERCADO_LIVRE' as const,
          status: 'AVAILABLE' as const,
          confidence: 'HIGH' as const,
          validationEvidence: visitsEvidence as Prisma.InputJsonArray,
        };
        const conversionData = conversion === null
          ? {
              value: null,
              source: 'DERIVED' as const,
              status: 'UNAVAILABLE' as const,
              confidence: 'LOW' as const,
              validationEvidence: conversionEvidence,
            }
          : {
              value: conversion,
              source: 'DERIVED' as const,
              status: 'AVAILABLE' as const,
              confidence: 'HIGH' as const,
              validationEvidence: conversionEvidence,
            };
        const changed =
          metricChanged(currentVisits, visitsData) ||
          metricChanged(currentConversion, conversionData);

        if (params.apply && changed) {
          await this.database.$transaction(async (transaction) => {
            await transaction.dailySellerMetric.update({
              where: {
                dailySellerMetricsId_name: {
                  dailySellerMetricsId: snapshot.id,
                  name: 'VISITS',
                },
              },
              data: visitsData,
            });
            await transaction.dailySellerMetric.update({
              where: {
                dailySellerMetricsId_name: {
                  dailySellerMetricsId: snapshot.id,
                  name: 'CONVERSION_RATE',
                },
              },
              data: conversionData,
            });
          }, TRANSACTION_OPTIONS);
        }

        days.push({
          businessDate,
          persistedVisits: decimalString(currentVisits.value),
          correctedVisits: visits,
          delta:
            currentVisits.value === null
              ? null
              : new Prisma.Decimal(visits).minus(currentVisits.value).toString(),
          salesCount: sales.value.toString(),
          persistedConversionRate: decimalString(currentConversion.value),
          correctedConversionRate: conversion?.toString() ?? null,
          action: changed
            ? params.apply
              ? 'UPDATED'
              : 'WOULD_UPDATE'
            : 'UNCHANGED',
          error: null,
        });
      } catch (error: unknown) {
        days.push(failedDay(
          businessDate,
          currentVisits.value,
          sales.value,
          currentConversion.value,
          safeError(error),
        ));
      }
    }

    return {
      marketplaceAccountId: account.id,
      marketplaceAccountName: account.name,
      from: params.from,
      to: params.to,
      apply: params.apply ?? false,
      days,
      updated: days.filter(({ action }) => action === 'UPDATED').length,
      unchanged: days.filter(({ action }) => action === 'UNCHANGED').length,
      failed: days.filter(({ action }) => action === 'FAILED').length,
    };
  }

  private async emptySummary(
    marketplaceAccountId: string,
    currentDate: string,
  ): Promise<SellerBiVisitsRefreshSummary> {
    const account = await this.database.marketplaceAccount.findUnique({
      where: { id: marketplaceAccountId },
      select: { name: true },
    });
    if (!account) {
      throw new SellerBiVisitsRefreshError('Marketplace account not found.');
    }
    return {
      marketplaceAccountId,
      marketplaceAccountName: account.name,
      from: currentDate,
      to: currentDate,
      apply: true,
      days: [],
      updated: 0,
      unchanged: 0,
      failed: 0,
    };
  }
}

function conversionRate(
  salesCount: Prisma.Decimal,
  visits: number,
): Prisma.Decimal | null {
  if (visits === 0) return null;
  return salesCount.mul(100).dividedBy(visits).toDecimalPlaces(10);
}

function officialVisitsEvidence(
  visits: number,
  businessDate: string,
): Prisma.InputJsonObject {
  return {
    metric: 'visits',
    source: 'MERCADO_LIVRE',
    value: visits,
    status: 'AVAILABLE',
    comparison: 'PRIMARY',
    semantic: VISITS_SEMANTIC,
    absoluteDifference: null,
    percentageDifference: null,
    notes: `Official daily query with inclusive date_from=date_to=${businessDate}; the calendar label is not timezone-converted.`,
  };
}

function metricChanged(
  current: {
    value: Prisma.Decimal | null;
    source: string;
    status: string;
    confidence: string;
    validationEvidence: Prisma.JsonValue;
  },
  expected: {
    value: Prisma.Decimal | null;
    source: string;
    status: string;
    confidence: string;
    validationEvidence: Prisma.InputJsonValue;
  },
): boolean {
  return (
    !decimalEquals(current.value, expected.value) ||
    current.source !== expected.source ||
    current.status !== expected.status ||
    current.confidence !== expected.confidence ||
    canonicalJson(current.validationEvidence) !==
      canonicalJson(expected.validationEvidence)
  );
}

function canonicalJson(value: Prisma.JsonValue | Prisma.InputJsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function decimalEquals(
  left: Prisma.Decimal | null,
  right: Prisma.Decimal | null,
): boolean {
  return left === null ? right === null : right !== null && left.equals(right);
}

function decimalString(value: Prisma.Decimal | null): string | null {
  return value?.toString() ?? null;
}

function failedDay(
  businessDate: string,
  visits: Prisma.Decimal | null,
  sales: Prisma.Decimal | null,
  conversion: Prisma.Decimal | null,
  error: string,
): SellerBiVisitsRefreshDay {
  return {
    businessDate,
    persistedVisits: decimalString(visits),
    correctedVisits: null,
    delta: null,
    salesCount: decimalString(sales),
    persistedConversionRate: decimalString(conversion),
    correctedConversionRate: null,
    action: 'FAILED',
    error,
  };
}

function safeError(error: unknown): string {
  if (error instanceof MercadoLivreClientError) {
    return `${error.name}/${error.code}`;
  }
  return error instanceof Error ? error.name : 'UnknownError';
}

function parseBusinessDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SellerBiVisitsRefreshError('Business date must use YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || calendarLabel(date) !== value) {
    throw new SellerBiVisitsRefreshError('Business date must be a real calendar date.');
  }
  return date;
}

function calendarLabel(value: Date): string {
  return value.toISOString().slice(0, 10);
}
