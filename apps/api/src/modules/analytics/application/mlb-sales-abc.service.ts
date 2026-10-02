import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace, Prisma } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  MlbSalesAbcMetric,
  MlbSalesAbcScope,
} from '../http/mlb-sales-abc-query.dto.js';

const INCLUDED_ACCOUNTS = ['C1', 'C2'] as const;
const PERCENTAGE_SCALE = 6;

export type MlbAbcClass = 'A' | 'B' | 'C';

interface DecimalLike {
  toString(): string;
}

export interface MlbSalesAbcSourceItem {
  externalListingId: string;
  quantity: number;
  unitPrice: DecimalLike;
  grossAmount?: DecimalLike;
  marketplaceOrder: {
    id: string;
    normalizedStatus?: string;
    marketplaceAccount: {
      businessAccount: { code: string } | null;
    };
  };
}

export interface MlbSalesAbcItem {
  mlb: string;
  account: string;
  salesCount: number;
  unitsSold: number;
  grossRevenue: string;
  participationPercent: number;
  cumulativePercent: number;
  abcClass: MlbAbcClass;
  rank: number;
}

export interface MlbSalesAbcReport {
  periodStart: string;
  periodEnd: string;
  timezone: string;
  scope: MlbSalesAbcScope;
  metric: MlbSalesAbcMetric;
  totalSales: number;
  totalUnits: number;
  totalGrossRevenue: string;
  totalMlbs: number;
  mlbs: MlbSalesAbcItem[];
}

export interface MlbSalesAbcRequest {
  start: string;
  end: string;
  scope: MlbSalesAbcScope;
  metric: MlbSalesAbcMetric;
}

@Injectable()
export class MlbSalesAbcService {
  private readonly businessTimeZone: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.businessTimeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async find(request: MlbSalesAbcRequest): Promise<MlbSalesAbcReport> {
    const start = localDateToUtc(request.start, this.businessTimeZone, 'start');
    const end = localDateToUtc(request.end, this.businessTimeZone, 'end');
    if (start >= end) {
      throw new BadRequestException('start must be earlier than end.');
    }

    const accountCodes =
      request.scope === MlbSalesAbcScope.Consolidated
        ? [...INCLUDED_ACCOUNTS]
        : [request.scope];
    const items = await this.database.marketplaceOrderItem.findMany({
      where: {
        marketplaceOrder: {
          is: {
            soldAt: { gte: start, lt: end },
            marketplaceAccount: {
              is: {
                marketplace: Marketplace.MERCADO_LIVRE,
                businessAccount: { is: { code: { in: accountCodes } } },
              },
            },
          },
        },
      },
      select: {
        externalListingId: true,
        quantity: true,
        unitPrice: true,
        marketplaceOrder: {
          select: {
            id: true,
            marketplaceAccount: {
              select: {
                businessAccount: { select: { code: true } },
              },
            },
          },
        },
      },
    });

    return calculateMlbSalesAbc({
      ...request,
      timezone: this.businessTimeZone,
      items,
    });
  }
}

export function calculateMlbSalesAbc(input: MlbSalesAbcRequest & {
  timezone: string;
  items: MlbSalesAbcSourceItem[];
}): MlbSalesAbcReport {
  const byMlb = new Map<string, {
    accounts: Set<string>;
    orderIds: Set<string>;
    units: number;
    grossRevenue: Prisma.Decimal;
  }>();
  const totalOrderIds = new Set<string>();
  let totalUnits = 0;
  let totalGrossRevenue = new Prisma.Decimal(0);

  for (const item of input.items) {
    const account = item.marketplaceOrder.marketplaceAccount.businessAccount?.code;
    if (!account) {
      throw new Error('Marketplace order item has no BusinessAccount code.');
    }
    const grossRevenue = new Prisma.Decimal(item.unitPrice.toString()).mul(
      item.quantity,
    );
    const aggregate = byMlb.get(item.externalListingId) ?? {
      accounts: new Set<string>(),
      orderIds: new Set<string>(),
      units: 0,
      grossRevenue: new Prisma.Decimal(0),
    };
    aggregate.accounts.add(account);
    aggregate.orderIds.add(item.marketplaceOrder.id);
    aggregate.units += item.quantity;
    aggregate.grossRevenue = aggregate.grossRevenue.plus(grossRevenue);
    byMlb.set(item.externalListingId, aggregate);

    totalOrderIds.add(item.marketplaceOrder.id);
    totalUnits += item.quantity;
    totalGrossRevenue = totalGrossRevenue.plus(grossRevenue);
  }

  const metricTotal =
    input.metric === MlbSalesAbcMetric.Units
      ? new Prisma.Decimal(totalUnits)
      : totalGrossRevenue;
  const ranked = [...byMlb.entries()].sort(([leftMlb, left], [rightMlb, right]) => {
    const metricComparison = metricValue(right, input.metric).comparedTo(
      metricValue(left, input.metric),
    );
    if (metricComparison !== 0) return metricComparison;
    return leftMlb < rightMlb ? -1 : leftMlb > rightMlb ? 1 : 0;
  });

  let cumulative = new Prisma.Decimal(0);
  const mlbs = ranked.map(([mlb, aggregate], index): MlbSalesAbcItem => {
    const value = metricValue(aggregate, input.metric);
    const abcClass = classifyByCumulativeBefore(cumulative, metricTotal);
    cumulative = cumulative.plus(value);
    return {
      mlb,
      account: [...aggregate.accounts].sort().join(','),
      salesCount: aggregate.orderIds.size,
      unitsSold: aggregate.units,
      grossRevenue: money(aggregate.grossRevenue),
      participationPercent: percentage(value, metricTotal),
      cumulativePercent: percentage(cumulative, metricTotal),
      abcClass,
      rank: index + 1,
    };
  });

  return {
    periodStart: input.start,
    periodEnd: input.end,
    timezone: input.timezone,
    scope: input.scope,
    metric: input.metric,
    totalSales: totalOrderIds.size,
    totalUnits,
    totalGrossRevenue: money(totalGrossRevenue),
    totalMlbs: mlbs.length,
    mlbs,
  };
}

function metricValue(
  aggregate: { units: number; grossRevenue: Prisma.Decimal },
  metric: MlbSalesAbcMetric,
): Prisma.Decimal {
  return metric === MlbSalesAbcMetric.Units
    ? new Prisma.Decimal(aggregate.units)
    : aggregate.grossRevenue;
}

function classifyByCumulativeBefore(
  cumulativeBefore: Prisma.Decimal,
  total: Prisma.Decimal,
): MlbAbcClass {
  if (total.isZero() || cumulativeBefore.mul(100).lt(total.mul(80))) return 'A';
  if (cumulativeBefore.mul(100).lt(total.mul(95))) return 'B';
  return 'C';
}

function percentage(value: Prisma.Decimal, total: Prisma.Decimal): number {
  if (total.isZero()) return 0;
  return value
    .dividedBy(total)
    .mul(100)
    .toDecimalPlaces(PERCENTAGE_SCALE)
    .toNumber();
}

function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function localDateToUtc(
  value: string,
  timeZone: string,
  field: 'start' | 'end',
): Date {
  const parts = parseLocalDate(value, field);
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = targetAsUtc;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const represented = datePartsInTimeZone(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate = targetAsUtc - (representedAsUtc - candidate);
  }

  return new Date(candidate);
}

function parseLocalDate(
  value: string,
  field: 'start' | 'end',
): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    !match ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth
  ) {
    throw new BadRequestException(
      `${field} must be a valid calendar date in YYYY-MM-DD format.`,
    );
  }
  return { year, month, day };
}

function datePartsInTimeZone(date: Date, timeZone: string) {
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
    second: values.get('second')!,
  };
}
