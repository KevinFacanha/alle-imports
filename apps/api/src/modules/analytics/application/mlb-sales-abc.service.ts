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
export type MlbAbcMovement = 'IMPROVED' | 'DECLINED' | 'STABLE' | 'NEW';
export type MlbRevenueMovement = 'INCREASED' | 'DECREASED' | 'STABLE' | 'NEW';
export type MlbAbcClassTransition = `${MlbAbcClass}_TO_${MlbAbcClass}`;

interface DecimalLike {
  toString(): string;
}

export interface MlbSalesAbcSourceItem {
  externalListingId: string;
  listingTitle?: string | null;
  quantity: number;
  unitPrice: DecimalLike;
  grossAmount?: DecimalLike;
  marketplaceOrder: {
    id: string;
    soldAt?: Date;
    normalizedStatus?: string;
    marketplaceAccount: {
      businessAccount: { code: string } | null;
    };
  };
}

export interface MlbSalesAbcItem {
  mlb: string;
  title: string | null;
  account: string;
  salesCount: number;
  unitsSold: number;
  grossRevenue: string;
  participationPercent: number;
  cumulativePercent: number;
  abcClass: MlbAbcClass;
  rank: number;
}

export interface MlbSalesAbcMovementItem extends MlbSalesAbcItem {
  currentClass: MlbAbcClass;
  previousClass: MlbAbcClass | null;
  movement: MlbAbcMovement;
  classTransition: MlbAbcClassTransition | null;
  currentRank: number;
  previousRank: number | null;
  rankDelta: number | null;
  currentUnits: number;
  previousUnits: number;
  unitsDelta: number;
  unitsDeltaPercent: number | null;
  currentGrossRevenue: string;
  previousGrossRevenue: string;
  grossRevenueDelta: string;
  grossRevenueDeltaPercent: number | null;
  revenueMovement: MlbRevenueMovement;
  revenueEnteringWindow: string;
  revenueLeavingWindow: string;
  unitsEnteringWindow: number;
  unitsLeavingWindow: number;
}

export interface MlbSalesAbcMovementSummary {
  declined: number;
  improved: number;
  stable: number;
  new: number;
  aToB: number;
  aToC: number;
  bToC: number;
  revenueDecreased: number;
  revenueIncreased: number;
  grossRevenueLoss: string;
  grossRevenueGain: string;
}

interface MlbWindowMovement {
  revenueEnteringWindow: Prisma.Decimal;
  revenueLeavingWindow: Prisma.Decimal;
  unitsEnteringWindow: number;
  unitsLeavingWindow: number;
}

export interface MlbSalesAbcReport {
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  timezone: string;
  scope: MlbSalesAbcScope;
  metric: MlbSalesAbcMetric;
  totalSales: number;
  totalUnits: number;
  totalGrossRevenue: string;
  totalMlbs: number;
  lastUpdatedAt: string | null;
  lastSyncedAt: string | null;
  movementSummary: MlbSalesAbcMovementSummary;
  mlbs: MlbSalesAbcMovementItem[];
}

type MlbSalesAbcBaseReport = Omit<
  MlbSalesAbcReport,
  | 'previousPeriodStart'
  | 'previousPeriodEnd'
  | 'lastUpdatedAt'
  | 'lastSyncedAt'
  | 'movementSummary'
  | 'mlbs'
> & { mlbs: MlbSalesAbcItem[] };

export interface MlbSalesAbcRequest {
  start?: string;
  end?: string;
  days?: 30 | 60 | 90;
  scope: MlbSalesAbcScope;
  metric: MlbSalesAbcMetric;
}

interface ResolvedMlbSalesAbcRequest {
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
    const resolved = resolveMlbAbcPeriod(request, this.businessTimeZone);
    const start = localDateToUtc(resolved.start, this.businessTimeZone, 'start');
    const end = localDateToUtc(resolved.end, this.businessTimeZone, 'end');
    if (start >= end) {
      throw new BadRequestException('start must be earlier than end.');
    }
    const previous = shiftResolvedPeriod(resolved, -1);
    const previousStart = localDateToUtc(
      previous.start,
      this.businessTimeZone,
      'start',
    );
    const previousEnd = localDateToUtc(
      previous.end,
      this.businessTimeZone,
      'end',
    );

    const accountCodes =
      resolved.scope === MlbSalesAbcScope.Consolidated
        ? [...INCLUDED_ACCOUNTS]
        : [resolved.scope];
    const [items, latestOrder, latestCompletedRun] = await Promise.all([
      this.database.marketplaceOrderItem.findMany({
        where: {
          marketplaceOrder: {
            is: {
              soldAt: { gte: previousStart, lt: end },
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
              soldAt: true,
              marketplaceAccount: {
                select: {
                  businessAccount: { select: { code: true } },
                },
              },
            },
          },
        },
      }),
      this.database.marketplaceOrder.aggregate({
        where: {
          marketplaceAccount: {
            is: {
              marketplace: Marketplace.MERCADO_LIVRE,
              businessAccount: { is: { code: { in: accountCodes } } },
            },
          },
        },
        _max: { updatedAt: true },
      }),
      this.database.marketplaceOrderBackfillRun.aggregate({
        where: {
          status: 'COMPLETED',
          marketplaceAccount: {
            is: {
              marketplace: Marketplace.MERCADO_LIVRE,
              businessAccount: { is: { code: { in: accountCodes } } },
            },
          },
        },
        _max: { completedAt: true },
      }),
    ]);
    const listingIds = [...new Set(items.map(({ externalListingId }) => externalListingId))];
    const listings = listingIds.length === 0
      ? []
      : await this.database.marketplaceListing.findMany({
          where: {
            externalListingId: { in: listingIds },
            marketplaceAccount: {
              is: {
                marketplace: Marketplace.MERCADO_LIVRE,
                businessAccount: { is: { code: { in: accountCodes } } },
              },
            },
          },
          select: {
            externalListingId: true,
            title: true,
            marketplaceAccount: {
              select: {
                businessAccount: { select: { code: true } },
              },
            },
          },
        });
    const titlesByAccountAndMlb = new Map(
      listings.flatMap((listing) => {
        const account = listing.marketplaceAccount.businessAccount?.code;
        return account
          ? [[listingKey(account, listing.externalListingId), listing.title] as const]
          : [];
      }),
    );
    const titledItems = items.map((item) => {
      const account = item.marketplaceOrder.marketplaceAccount.businessAccount?.code;
      return {
        ...item,
        listingTitle: account
          ? titlesByAccountAndMlb.get(listingKey(account, item.externalListingId)) ?? null
          : null,
      };
    });

    const currentItems = titledItems.filter(({ marketplaceOrder }) => {
      const soldAt = marketplaceOrder.soldAt;
      return soldAt !== undefined && soldAt >= start && soldAt < end;
    });
    const previousItems = titledItems.filter(({ marketplaceOrder }) => {
      const soldAt = marketplaceOrder.soldAt;
      return (
        soldAt !== undefined && soldAt >= previousStart && soldAt < previousEnd
      );
    });
    const windowMovement = calculateWindowMovement(
      titledItems.filter(({ marketplaceOrder }) => {
        const soldAt = marketplaceOrder.soldAt;
        return soldAt !== undefined && soldAt >= previousEnd && soldAt < end;
      }),
      titledItems.filter(({ marketplaceOrder }) => {
        const soldAt = marketplaceOrder.soldAt;
        return soldAt !== undefined && soldAt >= previousStart && soldAt < start;
      }),
    );
    const currentReport = calculateMlbSalesAbc({
      ...resolved,
      timezone: this.businessTimeZone,
      items: currentItems,
    });
    const previousReport = calculateMlbSalesAbc({
      ...previous,
      timezone: this.businessTimeZone,
      items: previousItems,
    });
    const comparison = compareMlbSalesAbc(
      currentReport,
      previousReport,
      windowMovement,
    );

    return {
      ...currentReport,
      previousPeriodStart: previous.start,
      previousPeriodEnd: previous.end,
      ...comparison,
      lastUpdatedAt: latestOrder._max.updatedAt?.toISOString() ?? null,
      lastSyncedAt: latestCompletedRun._max.completedAt?.toISOString() ?? null,
    };
  }
}

export function calculateMlbSalesAbc(input: ResolvedMlbSalesAbcRequest & {
  timezone: string;
  items: MlbSalesAbcSourceItem[];
}): MlbSalesAbcBaseReport {
  const byMlb = new Map<string, {
    accounts: Set<string>;
    titlesByAccount: Map<string, string | null>;
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
      titlesByAccount: new Map<string, string | null>(),
      orderIds: new Set<string>(),
      units: 0,
      grossRevenue: new Prisma.Decimal(0),
    };
    aggregate.accounts.add(account);
    aggregate.titlesByAccount.set(account, item.listingTitle ?? null);
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
      title:
        [...aggregate.titlesByAccount.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .find(([, title]) => title !== null)?.[1] ?? null,
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

export function compareMlbSalesAbc(
  current: MlbSalesAbcBaseReport,
  previous: MlbSalesAbcBaseReport,
  windowMovement: ReadonlyMap<string, MlbWindowMovement> = new Map(),
): {
  movementSummary: MlbSalesAbcMovementSummary;
  mlbs: MlbSalesAbcMovementItem[];
} {
  const previousByMlb = new Map(previous.mlbs.map((item) => [item.mlb, item]));
  const movementSummary: MlbSalesAbcMovementSummary = {
    declined: 0,
    improved: 0,
    stable: 0,
    new: 0,
    aToB: 0,
    aToC: 0,
    bToC: 0,
    revenueDecreased: 0,
    revenueIncreased: 0,
    grossRevenueLoss: '0.00',
    grossRevenueGain: '0.00',
  };
  let grossRevenueLoss = new Prisma.Decimal(0);
  let grossRevenueGain = new Prisma.Decimal(0);
  const mlbs = current.mlbs.map((item): MlbSalesAbcMovementItem => {
    const previousItem = previousByMlb.get(item.mlb);
    const movement = movementFromClasses(item.abcClass, previousItem?.abcClass);
    const currentGrossRevenue = new Prisma.Decimal(item.grossRevenue);
    const previousGrossRevenue = previousItem
      ? new Prisma.Decimal(previousItem.grossRevenue)
      : new Prisma.Decimal(0);
    const grossRevenueDelta = currentGrossRevenue.minus(previousGrossRevenue);
    const revenueMovement = revenueMovementFromDelta(
      grossRevenueDelta,
      previousItem !== undefined,
    );
    const window = windowMovement.get(item.mlb);
    const classTransition = previousItem
      ? (`${previousItem.abcClass}_TO_${item.abcClass}` as MlbAbcClassTransition)
      : null;
    if (movement === 'DECLINED') movementSummary.declined += 1;
    else if (movement === 'IMPROVED') movementSummary.improved += 1;
    else if (movement === 'STABLE') movementSummary.stable += 1;
    else movementSummary.new += 1;
    if (classTransition === 'A_TO_B') movementSummary.aToB += 1;
    if (classTransition === 'A_TO_C') movementSummary.aToC += 1;
    if (classTransition === 'B_TO_C') movementSummary.bToC += 1;
    if (revenueMovement === 'DECREASED') {
      movementSummary.revenueDecreased += 1;
      grossRevenueLoss = grossRevenueLoss.plus(grossRevenueDelta.abs());
    } else if (revenueMovement === 'INCREASED') {
      movementSummary.revenueIncreased += 1;
      grossRevenueGain = grossRevenueGain.plus(grossRevenueDelta);
    }

    return {
      ...item,
      currentClass: item.abcClass,
      previousClass: previousItem?.abcClass ?? null,
      movement,
      classTransition,
      currentRank: item.rank,
      previousRank: previousItem?.rank ?? null,
      rankDelta: previousItem ? previousItem.rank - item.rank : null,
      currentUnits: item.unitsSold,
      previousUnits: previousItem?.unitsSold ?? 0,
      unitsDelta: item.unitsSold - (previousItem?.unitsSold ?? 0),
      unitsDeltaPercent: deltaPercent(
        new Prisma.Decimal(item.unitsSold),
        previousItem ? new Prisma.Decimal(previousItem.unitsSold) : null,
      ),
      currentGrossRevenue: item.grossRevenue,
      previousGrossRevenue: previousItem?.grossRevenue ?? '0.00',
      grossRevenueDelta: money(grossRevenueDelta),
      grossRevenueDeltaPercent: deltaPercent(
        currentGrossRevenue,
        previousItem ? previousGrossRevenue : null,
      ),
      revenueMovement,
      revenueEnteringWindow: money(
        window?.revenueEnteringWindow ?? new Prisma.Decimal(0),
      ),
      revenueLeavingWindow: money(
        window?.revenueLeavingWindow ?? new Prisma.Decimal(0),
      ),
      unitsEnteringWindow: window?.unitsEnteringWindow ?? 0,
      unitsLeavingWindow: window?.unitsLeavingWindow ?? 0,
    };
  });
  movementSummary.grossRevenueLoss = money(grossRevenueLoss);
  movementSummary.grossRevenueGain = money(grossRevenueGain);
  return { movementSummary, mlbs };
}

function calculateWindowMovement(
  enteringItems: MlbSalesAbcSourceItem[],
  leavingItems: MlbSalesAbcSourceItem[],
): Map<string, MlbWindowMovement> {
  const movements = new Map<string, MlbWindowMovement>();
  const add = (item: MlbSalesAbcSourceItem, side: 'entering' | 'leaving') => {
    const movement = movements.get(item.externalListingId) ?? {
      revenueEnteringWindow: new Prisma.Decimal(0),
      revenueLeavingWindow: new Prisma.Decimal(0),
      unitsEnteringWindow: 0,
      unitsLeavingWindow: 0,
    };
    const revenue = new Prisma.Decimal(item.unitPrice.toString()).mul(
      item.quantity,
    );
    if (side === 'entering') {
      movement.revenueEnteringWindow =
        movement.revenueEnteringWindow.plus(revenue);
      movement.unitsEnteringWindow += item.quantity;
    } else {
      movement.revenueLeavingWindow = movement.revenueLeavingWindow.plus(revenue);
      movement.unitsLeavingWindow += item.quantity;
    }
    movements.set(item.externalListingId, movement);
  };
  enteringItems.forEach((item) => add(item, 'entering'));
  leavingItems.forEach((item) => add(item, 'leaving'));
  return movements;
}

function revenueMovementFromDelta(
  delta: Prisma.Decimal,
  hasPrevious: boolean,
): MlbRevenueMovement {
  if (!hasPrevious) return 'NEW';
  if (delta.gt(0)) return 'INCREASED';
  if (delta.lt(0)) return 'DECREASED';
  return 'STABLE';
}

function movementFromClasses(
  current: MlbAbcClass,
  previous?: MlbAbcClass,
): MlbAbcMovement {
  if (previous === undefined) return 'NEW';
  const priority: Record<MlbAbcClass, number> = { A: 0, B: 1, C: 2 };
  if (priority[current] < priority[previous]) return 'IMPROVED';
  if (priority[current] > priority[previous]) return 'DECLINED';
  return 'STABLE';
}

function deltaPercent(
  current: Prisma.Decimal,
  previous: Prisma.Decimal | null,
): number | null {
  if (previous === null || previous.isZero()) return null;
  return current
    .minus(previous)
    .dividedBy(previous)
    .mul(100)
    .toDecimalPlaces(PERCENTAGE_SCALE)
    .toNumber();
}

function listingKey(account: string, externalListingId: string): string {
  return `${account}\u0000${externalListingId}`;
}

export function resolveMlbAbcPeriod(
  request: MlbSalesAbcRequest,
  timezone: string,
  now = new Date(),
): ResolvedMlbSalesAbcRequest {
  if (request.days !== undefined) {
    if (request.start !== undefined || request.end !== undefined) {
      throw new BadRequestException(
        'days cannot be combined with start or end.',
      );
    }
    const today = datePartsInTimeZone(now, timezone);
    const end = addCivilDays(today, 1);
    const start = addCivilDays(end, -request.days);
    return {
      start: formatLocalDate(start),
      end: formatLocalDate(end),
      scope: request.scope,
      metric: request.metric,
    };
  }
  if (request.start === undefined || request.end === undefined) {
    throw new BadRequestException(
      'start and end are required when days is absent.',
    );
  }
  return {
    start: request.start,
    end: request.end,
    scope: request.scope,
    metric: request.metric,
  };
}

function shiftResolvedPeriod(
  period: ResolvedMlbSalesAbcRequest,
  days: number,
): ResolvedMlbSalesAbcRequest {
  return {
    ...period,
    start: formatLocalDate(
      addCivilDays(parseLocalDate(period.start, 'start'), days),
    ),
    end: formatLocalDate(addCivilDays(parseLocalDate(period.end, 'end'), days)),
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

function addCivilDays(
  parts: Pick<LocalDateParts, 'year' | 'month' | 'day'>,
  days: number,
): LocalDateParts {
  const result = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function formatLocalDate(parts: LocalDateParts): string {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
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
