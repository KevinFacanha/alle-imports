import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplaceOrderStatus } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';

const DAY_IN_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const C1 = 'C1';
const C2 = 'C2';

export type AbcClass = 'A' | 'B' | 'C';

interface DecimalLike {
  toString(): string;
}

export interface ProductSalesAbcSourceProduct {
  id: string;
  sku: string;
  name: string;
  externalIdentities: Array<{
    validTo: Date | null;
    businessAccount: { code: string };
  }>;
}

export interface ProductSalesAbcSourceItem {
  id: string;
  productId: string | null;
  quantity: number;
  marketplaceListingItem: { productId: string | null } | null;
  marketplaceOrder: {
    id: string;
    normalizedStatus: MarketplaceOrderStatus;
    soldAt: Date;
    paidAmount: DecimalLike | null;
    refundedAmount: DecimalLike | null;
    marketplaceAccount: {
      businessAccount: { code: string } | null;
    };
  };
}

export interface ProductSalesAbcSource {
  generatedAt: Date;
  loadedFrom: Date;
  loadedTo: Date;
  windowFrom: Date;
  windowTo: Date;
  windowDays: number;
  businessTimeZone: string;
  products: ProductSalesAbcSourceProduct[];
  historicalItems: Array<{
    id: string;
    productId: string | null;
    quantity: number;
    marketplaceListingItem: { productId: string | null } | null;
  }>;
  windowItems: ProductSalesAbcSourceItem[];
}

export interface ProductSalesAbcMetric {
  productId: string;
  sku: string;
  name: string;
  unitsSoldTotal: number;
  unitsSoldC1: number;
  unitsSoldC2: number;
  paidOrders: number;
  lastSaleAt: string | null;
  daysWithoutSale: number | null;
  noSaleForAtLeastWindow: boolean;
  volumePercentage: number;
  cumulativePercentage: number;
  abcClass: AbcClass;
}

export interface ProductAccountComparison {
  productId: string;
  sku: string;
  name: string;
  unitsC1: number;
  unitsC2: number;
  absoluteDifference: number;
  percentageDifference: number;
  participationC1: number;
  participationC2: number;
}

export interface CoverageMetrics {
  itemsTotal: number;
  itemsWithProduct: number;
  itemsWithoutProduct: number;
  itemCoveragePercentage: number;
  unitsTotal: number;
  unitsWithProduct: number;
  unitsWithoutProduct: number;
  unitCoveragePercentage: number;
}

export interface StatusImpact {
  status: MarketplaceOrderStatus;
  orders: number;
  items: number;
  units: number;
  itemsWithProduct: number;
  unitsWithProduct: number;
  paidAmount: number;
  refundedAmount: number;
  includedInBaseline: boolean;
}

export interface ProductSalesAbcReport {
  metadata: {
    generatedAt: string;
    loadedFrom: string;
    loadedTo: string;
    windowFrom: string;
    windowTo: string;
    windowDays: number;
    businessTimeZone: string;
    productScope: 'MATERIALIZED_HIGH_ONLY';
    productCount: number;
    validSaleStatuses: MarketplaceOrderStatus[];
    refundTreatment: 'EXCLUDED_AND_REPORTED_SEPARATELY';
    writesPerformed: 0;
  };
  relationshipAudit: {
    resolvedByOrderItemProduct: number;
    resolvedByListingItemProduct: number;
    unresolvedItems: number;
    conflictingProductLinks: number;
  };
  historicalCoverage: CoverageMetrics;
  validSalesCoverage: CoverageMetrics;
  statusImpact: StatusImpact[];
  totals: {
    validPaidOrders: number;
    validPaidUnits: number;
    coveredPaidOrders: number;
    coveredPaidUnits: number;
  };
  abcSummary: Array<{
    abcClass: AbcClass;
    products: number;
    units: number;
    participationPercentage: number;
  }>;
  top20: ProductSalesAbcMetric[];
  products: ProductSalesAbcMetric[];
  c1C2Comparison: ProductAccountComparison[];
}

@Injectable()
export class ProductSalesAbcService {
  private readonly businessTimeZone: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.businessTimeZone = config.get('BUSINESS_TIMEZONE', { infer: true });
  }

  async generate(windowDays = DEFAULT_WINDOW_DAYS): Promise<ProductSalesAbcReport> {
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      throw new Error('windowDays must be a positive integer.');
    }

    const loadedRange = await this.database.marketplaceOrder.aggregate({
      _min: { soldAt: true },
      _max: { soldAt: true },
    });
    const loadedFrom = loadedRange._min.soldAt;
    const loadedTo = loadedRange._max.soldAt;
    if (!loadedFrom || !loadedTo) {
      throw new Error('No persisted marketplace orders are available.');
    }

    const windowFrom = new Date(loadedTo.getTime() - windowDays * DAY_IN_MS);
    const [products, historicalItems, windowItems] = await Promise.all([
      this.database.product.findMany({
        orderBy: [{ sku: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          sku: true,
          name: true,
          externalIdentities: {
            select: {
              validTo: true,
              businessAccount: { select: { code: true } },
            },
          },
        },
      }),
      this.database.marketplaceOrderItem.findMany({
        select: {
          id: true,
          productId: true,
          quantity: true,
          marketplaceListingItem: { select: { productId: true } },
        },
      }),
      this.database.marketplaceOrderItem.findMany({
        where: {
          marketplaceOrder: {
            is: { soldAt: { gte: windowFrom, lte: loadedTo } },
          },
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          marketplaceListingItem: { select: { productId: true } },
          marketplaceOrder: {
            select: {
              id: true,
              normalizedStatus: true,
              soldAt: true,
              paidAmount: true,
              refundedAmount: true,
              marketplaceAccount: {
                select: {
                  businessAccount: { select: { code: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return calculateProductSalesAbc({
      generatedAt: new Date(),
      loadedFrom,
      loadedTo,
      windowFrom,
      windowTo: loadedTo,
      windowDays,
      businessTimeZone: this.businessTimeZone,
      products,
      historicalItems,
      windowItems,
    });
  }
}

export function calculateProductSalesAbc(
  source: ProductSalesAbcSource,
): ProductSalesAbcReport {
  const productIds = new Set(source.products.map(({ id }) => id));
  if (productIds.size !== source.products.length) {
    throw new Error('Product source contains duplicate ids.');
  }

  const relationshipAudit = auditRelationships(source.windowItems);
  const historicalCoverage = calculateCoverage(source.historicalItems);
  const statusImpact = calculateStatusImpact(source.windowItems);
  const validItems = source.windowItems.filter(
    ({ marketplaceOrder }) =>
      marketplaceOrder.normalizedStatus === MarketplaceOrderStatus.PAID,
  );
  const validSalesCoverage = calculateCoverage(validItems);
  const accumulators = new Map(
    source.products.map((product) => [
      product.id,
      {
        unitsTotal: 0,
        unitsC1: 0,
        unitsC2: 0,
        orderIds: new Set<string>(),
        lastSaleAt: null as Date | null,
      },
    ]),
  );
  const coveredOrderIds = new Set<string>();
  const validOrderIds = new Set<string>();

  for (const item of validItems) {
    validOrderIds.add(item.marketplaceOrder.id);
    const productId = resolveProductId(item);
    if (!productId) continue;
    const accumulator = accumulators.get(productId);
    if (!accumulator || !productIds.has(productId)) {
      throw new Error(`Order item ${item.id} resolves to unknown Product ${productId}.`);
    }

    accumulator.unitsTotal += item.quantity;
    const accountCode = item.marketplaceOrder.marketplaceAccount.businessAccount?.code;
    if (accountCode === C1) accumulator.unitsC1 += item.quantity;
    if (accountCode === C2) accumulator.unitsC2 += item.quantity;
    accumulator.orderIds.add(item.marketplaceOrder.id);
    coveredOrderIds.add(item.marketplaceOrder.id);
    if (
      !accumulator.lastSaleAt ||
      item.marketplaceOrder.soldAt > accumulator.lastSaleAt
    ) {
      accumulator.lastSaleAt = item.marketplaceOrder.soldAt;
    }
  }

  const coveredUnits = [...accumulators.values()].reduce(
    (total, metric) => total + metric.unitsTotal,
    0,
  );
  const sortedProducts = source.products
    .map((product) => ({ product, accumulator: accumulators.get(product.id)! }))
    .sort(
      (left, right) =>
        right.accumulator.unitsTotal - left.accumulator.unitsTotal ||
        left.product.sku.localeCompare(right.product.sku) ||
        left.product.id.localeCompare(right.product.id),
    );
  let cumulativeUnits = 0;
  const products = sortedProducts.map(({ product, accumulator }) => {
    const cumulativeBefore = percentage(cumulativeUnits, coveredUnits);
    const abcClass = classifyByCumulativeBefore(cumulativeBefore);
    cumulativeUnits += accumulator.unitsTotal;
    const lastSaleAt = accumulator.lastSaleAt;
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unitsSoldTotal: accumulator.unitsTotal,
      unitsSoldC1: accumulator.unitsC1,
      unitsSoldC2: accumulator.unitsC2,
      paidOrders: accumulator.orderIds.size,
      lastSaleAt: lastSaleAt?.toISOString() ?? null,
      daysWithoutSale: lastSaleAt
        ? businessDateDifference(
            lastSaleAt,
            source.windowTo,
            source.businessTimeZone,
          )
        : null,
      noSaleForAtLeastWindow: lastSaleAt === null,
      volumePercentage: percentage(accumulator.unitsTotal, coveredUnits),
      cumulativePercentage: percentage(cumulativeUnits, coveredUnits),
      abcClass,
    } satisfies ProductSalesAbcMetric;
  });
  const metricsByProductId = new Map(
    products.map((metric) => [metric.productId, metric]),
  );
  const c1C2Comparison = source.products
    .filter((product) => {
      const accountCodes = new Set(
        product.externalIdentities
          .filter(({ validTo }) => validTo === null)
          .map(({ businessAccount }) => businessAccount.code),
      );
      return accountCodes.has(C1) && accountCodes.has(C2);
    })
    .map((product) => {
      const metric = metricsByProductId.get(product.id)!;
      const combined = metric.unitsSoldC1 + metric.unitsSoldC2;
      const absoluteDifference = Math.abs(
        metric.unitsSoldC1 - metric.unitsSoldC2,
      );
      const mean = combined / 2;
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unitsC1: metric.unitsSoldC1,
        unitsC2: metric.unitsSoldC2,
        absoluteDifference,
        percentageDifference: mean === 0 ? 0 : (absoluteDifference / mean) * 100,
        participationC1: percentage(metric.unitsSoldC1, combined),
        participationC2: percentage(metric.unitsSoldC2, combined),
      };
    })
    .sort(
      (left, right) =>
        right.unitsC1 + right.unitsC2 - (left.unitsC1 + left.unitsC2) ||
        left.sku.localeCompare(right.sku) ||
        left.productId.localeCompare(right.productId),
    );

  return {
    metadata: {
      generatedAt: source.generatedAt.toISOString(),
      loadedFrom: source.loadedFrom.toISOString(),
      loadedTo: source.loadedTo.toISOString(),
      windowFrom: source.windowFrom.toISOString(),
      windowTo: source.windowTo.toISOString(),
      windowDays: source.windowDays,
      businessTimeZone: source.businessTimeZone,
      productScope: 'MATERIALIZED_HIGH_ONLY',
      productCount: source.products.length,
      validSaleStatuses: [MarketplaceOrderStatus.PAID],
      refundTreatment: 'EXCLUDED_AND_REPORTED_SEPARATELY',
      writesPerformed: 0,
    },
    relationshipAudit,
    historicalCoverage,
    validSalesCoverage,
    statusImpact,
    totals: {
      validPaidOrders: validOrderIds.size,
      validPaidUnits: validSalesCoverage.unitsTotal,
      coveredPaidOrders: coveredOrderIds.size,
      coveredPaidUnits: coveredUnits,
    },
    abcSummary: (['A', 'B', 'C'] as const).map((abcClass) => {
      const classProducts = products.filter(
        (product) => product.abcClass === abcClass,
      );
      const units = classProducts.reduce(
        (total, product) => total + product.unitsSoldTotal,
        0,
      );
      return {
        abcClass,
        products: classProducts.length,
        units,
        participationPercentage: percentage(units, coveredUnits),
      };
    }),
    top20: products.slice(0, 20),
    products,
    c1C2Comparison,
  };
}

function auditRelationships(items: ProductSalesAbcSourceItem[]): {
  resolvedByOrderItemProduct: number;
  resolvedByListingItemProduct: number;
  unresolvedItems: number;
  conflictingProductLinks: number;
} {
  let resolvedByOrderItemProduct = 0;
  let resolvedByListingItemProduct = 0;
  let unresolvedItems = 0;
  let conflictingProductLinks = 0;
  for (const item of items) {
    const direct = item.productId;
    const viaListing = item.marketplaceListingItem?.productId ?? null;
    if (direct && viaListing && direct !== viaListing) {
      conflictingProductLinks += 1;
      continue;
    }
    if (direct) resolvedByOrderItemProduct += 1;
    else if (viaListing) resolvedByListingItemProduct += 1;
    else unresolvedItems += 1;
  }
  if (conflictingProductLinks > 0) {
    throw new Error(
      `${conflictingProductLinks} order items have conflicting direct and listing Product links.`,
    );
  }
  return {
    resolvedByOrderItemProduct,
    resolvedByListingItemProduct,
    unresolvedItems,
    conflictingProductLinks,
  };
}

function calculateCoverage(
  items: Array<{
    productId: string | null;
    quantity: number;
    marketplaceListingItem: { productId: string | null } | null;
  }>,
): CoverageMetrics {
  let itemsWithProduct = 0;
  let unitsTotal = 0;
  let unitsWithProduct = 0;
  for (const item of items) {
    unitsTotal += item.quantity;
    if (resolveProductId(item)) {
      itemsWithProduct += 1;
      unitsWithProduct += item.quantity;
    }
  }
  return {
    itemsTotal: items.length,
    itemsWithProduct,
    itemsWithoutProduct: items.length - itemsWithProduct,
    itemCoveragePercentage: percentage(itemsWithProduct, items.length),
    unitsTotal,
    unitsWithProduct,
    unitsWithoutProduct: unitsTotal - unitsWithProduct,
    unitCoveragePercentage: percentage(unitsWithProduct, unitsTotal),
  };
}

function calculateStatusImpact(
  items: ProductSalesAbcSourceItem[],
): StatusImpact[] {
  const byStatus = new Map<
    MarketplaceOrderStatus,
    {
      orderIds: Set<string>;
      items: number;
      units: number;
      itemsWithProduct: number;
      unitsWithProduct: number;
      paidByOrder: Map<string, number>;
      refundedByOrder: Map<string, number>;
    }
  >();
  for (const item of items) {
    const order = item.marketplaceOrder;
    const total = byStatus.get(order.normalizedStatus) ?? {
      orderIds: new Set<string>(),
      items: 0,
      units: 0,
      itemsWithProduct: 0,
      unitsWithProduct: 0,
      paidByOrder: new Map<string, number>(),
      refundedByOrder: new Map<string, number>(),
    };
    total.orderIds.add(order.id);
    total.items += 1;
    total.units += item.quantity;
    if (resolveProductId(item)) {
      total.itemsWithProduct += 1;
      total.unitsWithProduct += item.quantity;
    }
    total.paidByOrder.set(order.id, numberValue(order.paidAmount));
    total.refundedByOrder.set(order.id, numberValue(order.refundedAmount));
    byStatus.set(order.normalizedStatus, total);
  }
  return Object.values(MarketplaceOrderStatus)
    .filter((status) => byStatus.has(status))
    .map((status) => {
      const total = byStatus.get(status)!;
      return {
        status,
        orders: total.orderIds.size,
        items: total.items,
        units: total.units,
        itemsWithProduct: total.itemsWithProduct,
        unitsWithProduct: total.unitsWithProduct,
        paidAmount: sumMap(total.paidByOrder),
        refundedAmount: sumMap(total.refundedByOrder),
        includedInBaseline: status === MarketplaceOrderStatus.PAID,
      };
    });
}

function resolveProductId(item: {
  productId: string | null;
  marketplaceListingItem: { productId: string | null } | null;
}): string | null {
  const viaListing = item.marketplaceListingItem?.productId ?? null;
  if (item.productId && viaListing && item.productId !== viaListing) {
    throw new Error('Conflicting direct and listing Product links.');
  }
  return item.productId ?? viaListing;
}

function classifyByCumulativeBefore(
  cumulativeBeforePercentage: number,
): AbcClass {
  if (cumulativeBeforePercentage < 80) return 'A';
  if (cumulativeBeforePercentage < 95) return 'B';
  return 'C';
}

export function businessDateDifference(
  from: Date,
  to: Date,
  timeZone: string,
): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const fromDate = datePartsToUtc(formatter.formatToParts(from));
  const toDate = datePartsToUtc(formatter.formatToParts(to));
  return Math.max(0, Math.floor((toDate - fromDate) / DAY_IN_MS));
}

function datePartsToUtc(parts: Intl.DateTimeFormatPart[]): number {
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return Date.UTC(
    Number(values.get('year')),
    Number(values.get('month')) - 1,
    Number(values.get('day')),
  );
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

function numberValue(value: DecimalLike | null): number {
  return value === null ? 0 : Number(value.toString());
}

function sumMap(values: Map<string, number>): number {
  return [...values.values()].reduce((total, value) => total + value, 0);
}
