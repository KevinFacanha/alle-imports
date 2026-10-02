import { Injectable } from '@nestjs/common';
import { MarketplaceOrderStatus } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  AbcClass,
  businessDateDifference,
  ProductSalesAbcReport,
  ProductSalesAbcService,
} from './product-sales-abc.service.js';

const DEFAULT_WINDOW_DAYS = 30;
const C1 = 'C1';
const C2 = 'C2';

export const PRODUCT_INTELLIGENCE_COVERAGE = Object.freeze({
  coveredPaidUnits: 3_538,
  totalPaidUnits: 6_712,
  coveragePercent: 52.71,
});

export interface ProductIntelligenceListingSource {
  id: string;
  productId: string | null;
  externalSellableId: string;
  sellerSku: string | null;
  active: boolean;
  marketplaceListing: {
    externalListingId: string;
    createdAt: Date;
    marketplaceAccount: {
      businessAccount: { code: string } | null;
    };
  };
  orderItems: Array<{
    quantity: number;
    marketplaceOrder: { soldAt: Date };
  }>;
}

export interface ProductIntelligenceSourceProduct {
  id: string;
  externalIdentities: Array<{
    validTo: Date | null;
    businessAccount: { code: string };
  }>;
}

export interface ProductIntelligenceHistoricalSale {
  id: string;
  productId: string | null;
  marketplaceListingItem: { productId: string | null } | null;
  marketplaceOrder: { soldAt: Date };
}

export interface ListingReference {
  listingId: string;
  listingItemId: string;
  externalSellableId: string;
  sellerSku: string | null;
  active: boolean;
}

export interface ProductIntelligenceProduct {
  productId: string;
  sku: string;
  unitsSoldTotal: number;
  unitsSoldC1: number;
  unitsSoldC2: number;
  paidOrders: number;
  abcClass: AbcClass;
  share: number;
  cumulativeShare: number;
  lastSaleAt: string | null;
  daysWithoutSale: number | null;
  accounts: string[];
}

export interface ProductRankingItem extends ProductIntelligenceProduct {
  rank: number;
}

export interface ProductAccountComparisonReadModel {
  productId: string;
  sku: string;
  unitsC1: number;
  unitsC2: number;
  difference: number;
  participationC1: number;
  participationC2: number;
  listingsC1: ListingReference[];
  listingsC2: ListingReference[];
}

export interface NoSaleListingAlert {
  status: 'NO_SALE_30D';
  account: string;
  listingId: string;
  listingItemId: string;
  externalSellableId: string;
  productId: string | null;
  sellerSku: string | null;
  listingAgeDays: number;
  lastSaleAt: string | null;
  daysWithoutSale: number;
}

interface ProductIntelligenceMetadata {
  windowDays: number;
  windowFrom: string;
  windowTo: string;
  generatedAt: string;
  readOnly: true;
}

interface CoveredResponse {
  coveredPaidUnits: number;
  totalPaidUnits: number;
  coveragePercent: number;
}

export interface ProductIntelligenceReadModel {
  metadata: ProductIntelligenceMetadata;
  products: ProductIntelligenceProduct[];
  rankings: {
    overall: ProductRankingItem[];
    c1: ProductRankingItem[];
    c2: ProductRankingItem[];
  };
  comparison: ProductAccountComparisonReadModel[];
  alerts: NoSaleListingAlert[];
}

export type ProductIntelligenceProductsResponse = CoveredResponse & {
  metadata: ProductIntelligenceMetadata;
  products: ProductIntelligenceProduct[];
};

export type ProductIntelligenceRankingsResponse = CoveredResponse & {
  metadata: ProductIntelligenceMetadata;
  rankings: ProductIntelligenceReadModel['rankings'];
};

export type ProductIntelligenceComparisonResponse = CoveredResponse & {
  metadata: ProductIntelligenceMetadata;
  products: ProductAccountComparisonReadModel[];
};

export type ProductIntelligenceAlertsResponse = CoveredResponse & {
  metadata: ProductIntelligenceMetadata;
  status: 'NO_SALE_30D';
  alerts: NoSaleListingAlert[];
};

@Injectable()
export class ProductIntelligenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly productSalesAbc: ProductSalesAbcService,
  ) {}

  async findProducts(): Promise<ProductIntelligenceProductsResponse> {
    const model = await this.load();
    return covered({ metadata: model.metadata, products: model.products });
  }

  async findRankings(): Promise<ProductIntelligenceRankingsResponse> {
    const model = await this.load();
    return covered({ metadata: model.metadata, rankings: model.rankings });
  }

  async findComparison(): Promise<ProductIntelligenceComparisonResponse> {
    const model = await this.load();
    return covered({ metadata: model.metadata, products: model.comparison });
  }

  async findNoSaleAlerts(): Promise<ProductIntelligenceAlertsResponse> {
    const model = await this.load();
    return covered({
      metadata: model.metadata,
      status: 'NO_SALE_30D',
      alerts: model.alerts,
    });
  }

  private async load(): Promise<ProductIntelligenceReadModel> {
    const [abcReport, products, listings, historicalSales] = await Promise.all([
      this.productSalesAbc.generate(DEFAULT_WINDOW_DAYS),
      this.database.product.findMany({
        orderBy: [{ sku: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          externalIdentities: {
            where: { validTo: null },
            select: {
              validTo: true,
              businessAccount: { select: { code: true } },
            },
          },
        },
      }),
      this.database.marketplaceListingItem.findMany({
        select: {
          id: true,
          productId: true,
          externalSellableId: true,
          sellerSku: true,
          active: true,
          marketplaceListing: {
            select: {
              externalListingId: true,
              createdAt: true,
              marketplaceAccount: {
                select: {
                  businessAccount: { select: { code: true } },
                },
              },
            },
          },
          orderItems: {
            where: {
              marketplaceOrder: {
                is: { normalizedStatus: MarketplaceOrderStatus.PAID },
              },
            },
            select: {
              quantity: true,
              marketplaceOrder: { select: { soldAt: true } },
            },
          },
        },
      }),
      this.database.marketplaceOrderItem.findMany({
        where: {
          marketplaceOrder: {
            is: { normalizedStatus: MarketplaceOrderStatus.PAID },
          },
        },
        select: {
          id: true,
          productId: true,
          marketplaceListingItem: { select: { productId: true } },
          marketplaceOrder: { select: { soldAt: true } },
        },
      }),
    ]);

    return buildProductIntelligence(
      abcReport,
      products,
      listings,
      historicalSales,
    );
  }
}

export function buildProductIntelligence(
  abcReport: ProductSalesAbcReport,
  sourceProducts: ProductIntelligenceSourceProduct[],
  listings: ProductIntelligenceListingSource[],
  historicalSales: ProductIntelligenceHistoricalSale[],
): ProductIntelligenceReadModel {
  const sourceByProductId = new Map(
    sourceProducts.map((product) => [product.id, product]),
  );
  const lastSaleByProductId = new Map<string, Date>();
  for (const sale of historicalSales) {
    const productId = resolveHistoricalProductId(sale);
    if (!productId) continue;
    const current = lastSaleByProductId.get(productId);
    if (!current || sale.marketplaceOrder.soldAt > current) {
      lastSaleByProductId.set(productId, sale.marketplaceOrder.soldAt);
    }
  }

  const products = abcReport.products.map((metric) => {
    const source = sourceByProductId.get(metric.productId);
    if (!source) {
      throw new Error(
        `Product Intelligence source is missing Product ${metric.productId}.`,
      );
    }
    const lastSaleAt = lastSaleByProductId.get(metric.productId) ?? null;
    return {
      productId: metric.productId,
      sku: metric.sku,
      unitsSoldTotal: metric.unitsSoldTotal,
      unitsSoldC1: metric.unitsSoldC1,
      unitsSoldC2: metric.unitsSoldC2,
      paidOrders: metric.paidOrders,
      abcClass: metric.abcClass,
      share: metric.volumePercentage,
      cumulativeShare: metric.cumulativePercentage,
      lastSaleAt: lastSaleAt?.toISOString() ?? null,
      daysWithoutSale: lastSaleAt
        ? businessDateDifference(
            lastSaleAt,
            new Date(abcReport.metadata.windowTo),
            abcReport.metadata.businessTimeZone,
          )
        : null,
      accounts: currentAccountCodes(source),
    } satisfies ProductIntelligenceProduct;
  });

  const rankingOverall = ranked(products, 'unitsSoldTotal');
  const rankingC1 = ranked(
    products.filter((product) => product.accounts.includes(C1)),
    'unitsSoldC1',
  );
  const rankingC2 = ranked(
    products.filter((product) => product.accounts.includes(C2)),
    'unitsSoldC2',
  );
  const comparison = abcReport.c1C2Comparison.map((metric) => {
    const source = sourceByProductId.get(metric.productId);
    if (!source) {
      throw new Error(
        `Product Intelligence source is missing Product ${metric.productId}.`,
      );
    }
    return {
      productId: metric.productId,
      sku: metric.sku,
      unitsC1: metric.unitsC1,
      unitsC2: metric.unitsC2,
      difference: metric.absoluteDifference,
      participationC1: metric.participationC1,
      participationC2: metric.participationC2,
      listingsC1: listingReferences(metric.productId, listings, C1),
      listingsC2: listingReferences(metric.productId, listings, C2),
    } satisfies ProductAccountComparisonReadModel;
  });

  return {
    metadata: {
      windowDays: abcReport.metadata.windowDays,
      windowFrom: abcReport.metadata.windowFrom,
      windowTo: abcReport.metadata.windowTo,
      generatedAt: abcReport.metadata.generatedAt,
      readOnly: true,
    },
    products,
    rankings: { overall: rankingOverall, c1: rankingC1, c2: rankingC2 },
    comparison,
    alerts: noSaleAlerts(abcReport, listings),
  };
}

function ranked(
  products: ProductIntelligenceProduct[],
  unitsField: 'unitsSoldTotal' | 'unitsSoldC1' | 'unitsSoldC2',
): ProductRankingItem[] {
  return [...products]
    .sort(
      (left, right) =>
        right[unitsField] - left[unitsField] ||
        left.sku.localeCompare(right.sku) ||
        left.productId.localeCompare(right.productId),
    )
    .map((product, index) => ({ ...product, rank: index + 1 }));
}

function currentAccountCodes(product: ProductIntelligenceSourceProduct): string[] {
  return [
    ...new Set(
      product.externalIdentities
        .filter(({ validTo }) => validTo === null)
        .map(({ businessAccount }) => businessAccount.code),
    ),
  ].sort();
}

function listingReferences(
  productId: string,
  listings: ProductIntelligenceListingSource[],
  accountCode: string,
): ListingReference[] {
  return listings
    .filter(
      (listing) =>
        listing.productId === productId &&
        listing.marketplaceListing.marketplaceAccount.businessAccount?.code ===
          accountCode,
    )
    .map((listing) => ({
      listingId: listing.marketplaceListing.externalListingId,
      listingItemId: listing.id,
      externalSellableId: listing.externalSellableId,
      sellerSku: listing.sellerSku,
      active: listing.active,
    }))
    .sort(
      (left, right) =>
        left.listingId.localeCompare(right.listingId) ||
        left.externalSellableId.localeCompare(right.externalSellableId) ||
        left.listingItemId.localeCompare(right.listingItemId),
    );
}

function noSaleAlerts(
  abcReport: ProductSalesAbcReport,
  listings: ProductIntelligenceListingSource[],
): NoSaleListingAlert[] {
  const windowFrom = new Date(abcReport.metadata.windowFrom);
  const windowTo = new Date(abcReport.metadata.windowTo);
  const alerts: NoSaleListingAlert[] = [];

  for (const listing of listings) {
      const account =
        listing.marketplaceListing.marketplaceAccount.businessAccount?.code;
      if (!listing.active || !account) continue;
      const listingAgeDays = businessDateDifference(
        listing.marketplaceListing.createdAt,
        windowTo,
        abcReport.metadata.businessTimeZone,
      );
      if (listingAgeDays < abcReport.metadata.windowDays) continue;

      const paidSales = listing.orderItems.filter(
        ({ marketplaceOrder }) => marketplaceOrder.soldAt <= windowTo,
      );
      const unitsInWindow = paidSales
        .filter(({ marketplaceOrder }) => marketplaceOrder.soldAt >= windowFrom)
        .reduce((total, sale) => total + sale.quantity, 0);
      if (unitsInWindow > 0) continue;

      const lastSaleAt = paidSales.reduce<Date | null>(
        (latest, sale) =>
          !latest || sale.marketplaceOrder.soldAt > latest
            ? sale.marketplaceOrder.soldAt
            : latest,
        null,
      );
      alerts.push({
        status: 'NO_SALE_30D',
        account,
        listingId: listing.marketplaceListing.externalListingId,
        listingItemId: listing.id,
        externalSellableId: listing.externalSellableId,
        productId: listing.productId,
        sellerSku: listing.sellerSku,
        listingAgeDays,
        lastSaleAt: lastSaleAt?.toISOString() ?? null,
        daysWithoutSale: lastSaleAt
          ? businessDateDifference(
              lastSaleAt,
              windowTo,
              abcReport.metadata.businessTimeZone,
            )
          : listingAgeDays,
      });
  }

  return alerts.sort(
    (left, right) =>
      right.daysWithoutSale - left.daysWithoutSale ||
      left.account.localeCompare(right.account) ||
      left.listingId.localeCompare(right.listingId) ||
      left.externalSellableId.localeCompare(right.externalSellableId),
  );
}

function resolveHistoricalProductId(
  sale: ProductIntelligenceHistoricalSale,
): string | null {
  const direct = sale.productId;
  const viaListing = sale.marketplaceListingItem?.productId ?? null;
  if (direct && viaListing && direct !== viaListing) {
    throw new Error(
      `Historical order item ${sale.id} has conflicting direct and listing Product links.`,
    );
  }
  return direct ?? viaListing;
}

function covered<T extends object>(response: T): T & CoveredResponse {
  return { ...PRODUCT_INTELLIGENCE_COVERAGE, ...response };
}
