import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ListingEquivalenceStatus,
  Marketplace,
  MarketplaceOrderStatus,
  Prisma,
} from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  MlbAbcClass,
  MlbSalesAbcReport,
  MlbSalesAbcService,
} from './mlb-sales-abc.service.js';
import {
  MlbSalesAbcMetric,
  MlbSalesAbcScope,
} from '../http/mlb-sales-abc-query.dto.js';

const ACCOUNTS = ['C1', 'C2'] as const;
type X1Account = (typeof ACCOUNTS)[number];
const PERCENTAGE_SCALE = 6;

export const X1_EFFECTIVE_SALE_STATUSES = Object.freeze([
  MarketplaceOrderStatus.PAID,
  MarketplaceOrderStatus.PROCESSING,
  MarketplaceOrderStatus.SHIPPED,
  MarketplaceOrderStatus.DELIVERED,
  MarketplaceOrderStatus.PARTIALLY_REFUNDED,
]);
const X1_EFFECTIVE_SALE_STATUS_SET = new Set<MarketplaceOrderStatus>(
  X1_EFFECTIVE_SALE_STATUSES,
);

const X1_EXCLUDED_SALE_STATUSES = Object.freeze([
  MarketplaceOrderStatus.PENDING,
  MarketplaceOrderStatus.CANCELLED,
  MarketplaceOrderStatus.REFUNDED,
  MarketplaceOrderStatus.UNKNOWN,
]);

/**
 * REVIEW_REQUIRED pairs intentionally have no ListingEquivalence row. The
 * matching-version manifest therefore supplies the complete candidate-pair
 * denominator; response pairs still come exclusively from CONFIRMED rows.
 */
const MATCHING_VERSION_COVERAGE: Readonly<Record<string, number>> = {
  'product-identity-matching-v2': 34,
};

interface DecimalLike {
  toString(): string;
}

interface X1ListingItemSource {
  id: string;
  externalSellableId: string;
  offerCompositions: Array<{
    quantity: DecimalLike;
    componentProduct: { id: string; sku: string; name: string };
  }>;
  marketplaceListing: {
    externalListingId: string;
    items: Array<{ id: string }>;
    marketplaceAccount: {
      marketplace: Marketplace;
      businessAccount: { code: string } | null;
    };
  };
}

export interface X1EquivalenceSource {
  componentSignature: string;
  confidence: DecimalLike;
  matchingVersion: string;
  leftListingItem: X1ListingItemSource;
  rightListingItem: X1ListingItemSource;
}

export interface X1OrderItemSource {
  marketplaceListingItemId: string | null;
  quantity: number;
  unitPrice: DecimalLike;
  marketplaceOrder: {
    id: string;
    soldAt: Date;
    normalizedStatus: MarketplaceOrderStatus;
  };
}

export interface X1AbcClassification {
  class: MlbAbcClass | null;
  rank: number | null;
}

export interface X1AccountMetrics {
  mlb: string;
  salesCount: number;
  soldOfferUnits: number;
  grossRevenue: string;
  normalizedPhysicalUnits: string;
  abc: {
    units: X1AbcClassification;
    grossRevenue: X1AbcClassification;
  };
}

export interface X1MetricDelta<T extends number | string> {
  absolute: T;
  percent: number | null;
}

export interface X1Component {
  c1SellableId: string;
  c2SellableId: string;
  baseProduct: { id: string; sku: string; name: string };
  compositionQuantity: { c1: string | null; c2: string | null };
  componentSignature: string;
  confidence: string;
  matchingVersion: string;
  consistencyError: boolean;
}

export interface X1MlbPair {
  c1: X1AccountMetrics;
  c2: X1AccountMetrics;
  deltas: {
    salesCount: X1MetricDelta<number>;
    soldOfferUnits: X1MetricDelta<number>;
    normalizedPhysicalUnits: X1MetricDelta<string>;
    grossRevenue: X1MetricDelta<string>;
  };
  components: X1Component[];
  consistencyError: boolean;
}

export interface X1ProductIntelligenceResponse {
  metadata: {
    generatedAt: string;
    timezone: string;
    days: 30 | 60 | 90;
    periodStart: string;
    periodEnd: string;
    saleDefinition: {
      includedStatuses: MarketplaceOrderStatus[];
      excludedStatuses: MarketplaceOrderStatus[];
    };
  };
  coverage: {
    confirmedEquivalences: number;
    fullyComparableMlbPairs: number;
    reviewRequiredMlbPairs: number;
    matchingVersion: string | null;
  };
  pairs: X1MlbPair[];
}

interface X1Period {
  startLabel: string;
  endLabel: string;
  endExclusiveLabel: string;
  start: Date;
  endExclusive: Date;
}

interface OrientedEquivalence {
  source: X1EquivalenceSource;
  c1: X1ListingItemSource;
  c2: X1ListingItemSource;
}

interface ComparableGroup {
  c1Mlb: string;
  c2Mlb: string;
  equivalences: OrientedEquivalence[];
}

interface AbcLookups {
  c1Units: ReadonlyMap<string, X1AbcClassification>;
  c1Revenue: ReadonlyMap<string, X1AbcClassification>;
  c2Units: ReadonlyMap<string, X1AbcClassification>;
  c2Revenue: ReadonlyMap<string, X1AbcClassification>;
}

@Injectable()
export class X1ProductIntelligenceService {
  private readonly businessTimeZone: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly mlbSalesAbc: MlbSalesAbcService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.businessTimeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async find(
    days: 30 | 60 | 90,
    now = new Date(),
  ): Promise<X1ProductIntelligenceResponse> {
    const period = resolveX1Period(days, this.businessTimeZone, now);
    const equivalencesPromise = this.database.listingEquivalence.findMany({
      where: {
        status: ListingEquivalenceStatus.CONFIRMED,
        validTo: null,
      },
      select: {
        componentSignature: true,
        confidence: true,
        matchingVersion: true,
        leftListingItem: { select: listingItemSelection },
        rightListingItem: { select: listingItemSelection },
      },
    });
    const abcPromise = this.findAbcLookups(period);
    const [equivalences, abc] = await Promise.all([
      equivalencesPromise,
      abcPromise,
    ]);
    const groups = comparableGroups(equivalences);
    const listingItemIds = [
      ...new Set(
        groups.flatMap((group) =>
          group.equivalences.flatMap(({ c1, c2 }) => [c1.id, c2.id]),
        ),
      ),
    ];
    const orderItems = listingItemIds.length === 0
      ? []
      : await this.database.marketplaceOrderItem.findMany({
          where: {
            marketplaceListingItemId: { in: listingItemIds },
            marketplaceOrder: {
              is: {
                soldAt: { gte: period.start, lt: period.endExclusive },
                normalizedStatus: { in: [...X1_EFFECTIVE_SALE_STATUSES] },
                marketplaceAccount: {
                  is: {
                    marketplace: Marketplace.MERCADO_LIVRE,
                    businessAccount: { is: { code: { in: [...ACCOUNTS] } } },
                  },
                },
              },
            },
          },
          select: {
            marketplaceListingItemId: true,
            quantity: true,
            unitPrice: true,
            marketplaceOrder: {
              select: {
                id: true,
                soldAt: true,
                normalizedStatus: true,
              },
            },
          },
        });

    return buildX1Response({
      days,
      timezone: this.businessTimeZone,
      now,
      period,
      equivalences,
      orderItems,
      abc,
    });
  }

  private async findAbcLookups(period: X1Period): Promise<AbcLookups> {
    const find = (scope: MlbSalesAbcScope, metric: MlbSalesAbcMetric) =>
      this.mlbSalesAbc.find({
        start: period.startLabel,
        end: period.endExclusiveLabel,
        scope,
        metric,
      });
    const [c1Units, c1Revenue, c2Units, c2Revenue] = await Promise.all([
      find(MlbSalesAbcScope.C1, MlbSalesAbcMetric.Units),
      find(MlbSalesAbcScope.C1, MlbSalesAbcMetric.GrossRevenue),
      find(MlbSalesAbcScope.C2, MlbSalesAbcMetric.Units),
      find(MlbSalesAbcScope.C2, MlbSalesAbcMetric.GrossRevenue),
    ]);
    return {
      c1Units: abcMap(c1Units),
      c1Revenue: abcMap(c1Revenue),
      c2Units: abcMap(c2Units),
      c2Revenue: abcMap(c2Revenue),
    };
  }
}

const listingItemSelection = {
  id: true,
  externalSellableId: true,
  offerCompositions: {
    where: { validTo: null },
    select: {
      quantity: true,
      componentProduct: { select: { id: true, sku: true, name: true } },
    },
  },
  marketplaceListing: {
    select: {
      externalListingId: true,
      items: { select: { id: true } },
      marketplaceAccount: {
        select: {
          marketplace: true,
          businessAccount: { select: { code: true } },
        },
      },
    },
  },
} satisfies Prisma.MarketplaceListingItemSelect;

export function buildX1Response(input: {
  days: 30 | 60 | 90;
  timezone: string;
  now: Date;
  period: X1Period;
  equivalences: X1EquivalenceSource[];
  orderItems: X1OrderItemSource[];
  abc?: AbcLookups;
}): X1ProductIntelligenceResponse {
  const groups = comparableGroups(input.equivalences);
  const itemsByListingItem = new Map<string, X1OrderItemSource[]>();
  for (const item of input.orderItems) {
    if (
      item.marketplaceListingItemId === null ||
      item.marketplaceOrder.soldAt < input.period.start ||
      item.marketplaceOrder.soldAt >= input.period.endExclusive ||
      !X1_EFFECTIVE_SALE_STATUS_SET.has(item.marketplaceOrder.normalizedStatus)
    ) {
      continue;
    }
    const items = itemsByListingItem.get(item.marketplaceListingItemId) ?? [];
    items.push(item);
    itemsByListingItem.set(item.marketplaceListingItemId, items);
  }
  const emptyAbc = new Map<string, X1AbcClassification>();
  const abc = input.abc ?? {
    c1Units: emptyAbc,
    c1Revenue: emptyAbc,
    c2Units: emptyAbc,
    c2Revenue: emptyAbc,
  };
  const pairs = groups.map((group) => {
    const c1 = accountMetrics(group, 'C1', itemsByListingItem, abc);
    const c2 = accountMetrics(group, 'C2', itemsByListingItem, abc);
    const components = group.equivalences
      .flatMap(componentRows)
      .sort((left, right) =>
        left.c1SellableId.localeCompare(right.c1SellableId) ||
        left.c2SellableId.localeCompare(right.c2SellableId) ||
        left.baseProduct.id.localeCompare(right.baseProduct.id),
      );
    return {
      c1,
      c2,
      deltas: {
        salesCount: numericDelta(c1.salesCount, c2.salesCount),
        soldOfferUnits: numericDelta(c1.soldOfferUnits, c2.soldOfferUnits),
        normalizedPhysicalUnits: decimalDelta(
          c1.normalizedPhysicalUnits,
          c2.normalizedPhysicalUnits,
        ),
        grossRevenue: decimalDelta(c1.grossRevenue, c2.grossRevenue, true),
      },
      components,
      consistencyError: components.some(({ consistencyError }) => consistencyError),
    } satisfies X1MlbPair;
  });
  const versions = [
    ...new Set(input.equivalences.map(({ matchingVersion }) => matchingVersion)),
  ].sort();
  const matchingVersion = versions.length === 0 ? null : versions.join(',');
  const partialPairs = confirmedMlbGroups(input.equivalences).length - groups.length;
  const candidatePairs = versions.length === 1
    ? MATCHING_VERSION_COVERAGE[versions[0]!]
    : undefined;

  return {
    metadata: {
      generatedAt: input.now.toISOString(),
      timezone: input.timezone,
      days: input.days,
      periodStart: input.period.startLabel,
      periodEnd: input.period.endLabel,
      saleDefinition: {
        includedStatuses: [...X1_EFFECTIVE_SALE_STATUSES],
        excludedStatuses: [...X1_EXCLUDED_SALE_STATUSES],
      },
    },
    coverage: {
      confirmedEquivalences: input.equivalences.length,
      fullyComparableMlbPairs: pairs.length,
      reviewRequiredMlbPairs: candidatePairs === undefined
        ? partialPairs
        : Math.max(partialPairs, candidatePairs - pairs.length),
      matchingVersion,
    },
    pairs: pairs.sort((left, right) =>
      left.c1.mlb.localeCompare(right.c1.mlb) ||
      left.c2.mlb.localeCompare(right.c2.mlb),
    ),
  };
}

function comparableGroups(
  equivalences: X1EquivalenceSource[],
): ComparableGroup[] {
  return confirmedMlbGroups(equivalences).filter((group) => {
    const c1ListingItems = new Set(
      group.equivalences[0]!.c1.marketplaceListing.items.map(({ id }) => id),
    );
    const c2ListingItems = new Set(
      group.equivalences[0]!.c2.marketplaceListing.items.map(({ id }) => id),
    );
    const matchedC1 = new Set(group.equivalences.map(({ c1 }) => c1.id));
    const matchedC2 = new Set(group.equivalences.map(({ c2 }) => c2.id));
    return (
      group.equivalences.length === matchedC1.size &&
      group.equivalences.length === matchedC2.size &&
      sameSet(c1ListingItems, matchedC1) &&
      sameSet(c2ListingItems, matchedC2) &&
      group.equivalences.every(
        ({ c1, c2 }) =>
          c1.offerCompositions.length > 0 && c2.offerCompositions.length > 0,
      )
    );
  });
}

function confirmedMlbGroups(
  equivalences: X1EquivalenceSource[],
): ComparableGroup[] {
  const groups = new Map<string, ComparableGroup>();
  for (const source of equivalences) {
    const oriented = orient(source);
    if (oriented === null) continue;
    const c1Mlb = oriented.c1.marketplaceListing.externalListingId;
    const c2Mlb = oriented.c2.marketplaceListing.externalListingId;
    const key = `${c1Mlb}\u0000${c2Mlb}`;
    const group = groups.get(key) ?? { c1Mlb, c2Mlb, equivalences: [] };
    group.equivalences.push(oriented);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function orient(source: X1EquivalenceSource): OrientedEquivalence | null {
  const leftAccount = listingAccount(source.leftListingItem);
  const rightAccount = listingAccount(source.rightListingItem);
  if (leftAccount === 'C1' && rightAccount === 'C2') {
    return { source, c1: source.leftListingItem, c2: source.rightListingItem };
  }
  if (leftAccount === 'C2' && rightAccount === 'C1') {
    return { source, c1: source.rightListingItem, c2: source.leftListingItem };
  }
  return null;
}

function listingAccount(item: X1ListingItemSource): X1Account | null {
  if (item.marketplaceListing.marketplaceAccount.marketplace !== Marketplace.MERCADO_LIVRE) {
    return null;
  }
  const code = item.marketplaceListing.marketplaceAccount.businessAccount?.code;
  return code === 'C1' || code === 'C2' ? code : null;
}

function accountMetrics(
  group: ComparableGroup,
  account: X1Account,
  itemsByListingItem: ReadonlyMap<string, X1OrderItemSource[]>,
  abc: AbcLookups,
): X1AccountMetrics {
  const listingItems = group.equivalences.map((equivalence) => equivalence[account.toLowerCase() as 'c1' | 'c2']);
  const orderIds = new Set<string>();
  let soldOfferUnits = 0;
  let grossRevenue = new Prisma.Decimal(0);
  let normalizedPhysicalUnits = new Prisma.Decimal(0);
  for (const listingItem of listingItems) {
    const compositionQuantity = listingItem.offerCompositions.reduce(
      (total, composition) => total.plus(composition.quantity.toString()),
      new Prisma.Decimal(0),
    );
    for (const orderItem of itemsByListingItem.get(listingItem.id) ?? []) {
      orderIds.add(orderItem.marketplaceOrder.id);
      soldOfferUnits += orderItem.quantity;
      grossRevenue = grossRevenue.plus(
        new Prisma.Decimal(orderItem.unitPrice.toString()).mul(orderItem.quantity),
      );
      normalizedPhysicalUnits = normalizedPhysicalUnits.plus(
        compositionQuantity.mul(orderItem.quantity),
      );
    }
  }
  const mlb = account === 'C1' ? group.c1Mlb : group.c2Mlb;
  return {
    mlb,
    salesCount: orderIds.size,
    soldOfferUnits,
    grossRevenue: money(grossRevenue),
    normalizedPhysicalUnits: decimal(normalizedPhysicalUnits),
    abc: {
      units: (account === 'C1' ? abc.c1Units : abc.c2Units).get(mlb) ?? nullAbc(),
      grossRevenue: (account === 'C1' ? abc.c1Revenue : abc.c2Revenue).get(mlb) ?? nullAbc(),
    },
  };
}

function componentRows(equivalence: OrientedEquivalence): X1Component[] {
  const c1ByProduct = new Map(
    equivalence.c1.offerCompositions.map((composition) => [
      composition.componentProduct.id,
      composition,
    ]),
  );
  const c2ByProduct = new Map(
    equivalence.c2.offerCompositions.map((composition) => [
      composition.componentProduct.id,
      composition,
    ]),
  );
  const productIds = [...new Set([...c1ByProduct.keys(), ...c2ByProduct.keys()])].sort();
  const compositionConsistent = sameSet(
    new Set(c1ByProduct.keys()),
    new Set(c2ByProduct.keys()),
  ) && productIds.every((productId) =>
    new Prisma.Decimal(c1ByProduct.get(productId)!.quantity.toString()).equals(
      c2ByProduct.get(productId)!.quantity.toString(),
    ),
  );
  return productIds.map((productId) => {
    const c1 = c1ByProduct.get(productId);
    const c2 = c2ByProduct.get(productId);
    const product = (c1 ?? c2)!.componentProduct;
    return {
      c1SellableId: equivalence.c1.externalSellableId,
      c2SellableId: equivalence.c2.externalSellableId,
      baseProduct: product,
      compositionQuantity: {
        c1: c1 ? decimal(new Prisma.Decimal(c1.quantity.toString())) : null,
        c2: c2 ? decimal(new Prisma.Decimal(c2.quantity.toString())) : null,
      },
      componentSignature: equivalence.source.componentSignature,
      confidence: equivalence.source.confidence.toString(),
      matchingVersion: equivalence.source.matchingVersion,
      consistencyError: !compositionConsistent,
    };
  });
}

function numericDelta(c1: number, c2: number): X1MetricDelta<number> {
  return {
    absolute: c1 - c2,
    percent: percentDelta(new Prisma.Decimal(c1), new Prisma.Decimal(c2)),
  };
}

function decimalDelta(
  c1Value: string,
  c2Value: string,
  monetary = false,
): X1MetricDelta<string> {
  const c1 = new Prisma.Decimal(c1Value);
  const c2 = new Prisma.Decimal(c2Value);
  const difference = c1.minus(c2);
  return {
    absolute: monetary ? money(difference) : decimal(difference),
    percent: percentDelta(c1, c2),
  };
}

function percentDelta(c1: Prisma.Decimal, c2: Prisma.Decimal): number | null {
  if (c2.isZero()) return null;
  return c1.minus(c2).div(c2).mul(100).toDecimalPlaces(PERCENTAGE_SCALE).toNumber();
}

function abcMap(report: MlbSalesAbcReport): Map<string, X1AbcClassification> {
  return new Map(
    report.mlbs.map(({ mlb, abcClass, rank }) => [
      mlb,
      { class: abcClass, rank },
    ]),
  );
}

function nullAbc(): X1AbcClassification {
  return { class: null, rank: null };
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

function decimal(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(10).toString();
}

export function resolveX1Period(
  days: 30 | 60 | 90,
  timezone: string,
  now = new Date(),
): X1Period {
  const today = datePartsInTimeZone(now, timezone);
  const start = addCivilDays(today, -days);
  const end = addCivilDays(today, -1);
  const startLabel = formatLocalDate(start);
  const endExclusiveLabel = formatLocalDate(today);
  return {
    startLabel,
    endLabel: formatLocalDate(end),
    endExclusiveLabel,
    start: localDateToUtc(startLabel, timezone),
    endExclusive: localDateToUtc(endExclusiveLabel, timezone),
  };
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function addCivilDays(parts: LocalDateParts, days: number): LocalDateParts {
  const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function formatLocalDate(parts: LocalDateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function localDateToUtc(value: string, timezone: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const represented = datePartsInTimeZone(new Date(candidate), timezone, true);
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

function datePartsInTimeZone(date: Date, timezone: string, withTime?: false): LocalDateParts;
function datePartsInTimeZone(date: Date, timezone: string, withTime: true): LocalDateParts & { hour: number; minute: number; second: number };
function datePartsInTimeZone(date: Date, timezone: string, withTime = false) {
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(withTime
        ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' as const }
        : {}),
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    ...(withTime
      ? { hour: values.get('hour')!, minute: values.get('minute')!, second: values.get('second')! }
      : {}),
  };
}
