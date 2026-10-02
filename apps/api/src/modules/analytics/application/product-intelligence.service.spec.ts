import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MarketplaceOrderStatus } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  buildProductIntelligence,
  ProductIntelligenceHistoricalSale,
  ProductIntelligenceListingSource,
  ProductIntelligenceService,
  ProductIntelligenceSourceProduct,
} from './product-intelligence.service.js';
import {
  calculateProductSalesAbc,
  ProductSalesAbcService,
  ProductSalesAbcSource,
  ProductSalesAbcSourceItem,
  ProductSalesAbcSourceProduct,
} from './product-sales-abc.service.js';

const WINDOW_TO = new Date('2026-09-29T12:00:00.000Z');
const WINDOW_FROM = new Date('2026-08-30T12:00:00.000Z');

describe('ProductIntelligenceService', () => {
  it('reuses ABC, ranks overall/C1/C2 and compares only canonically shared Products', () => {
    const fixture = intelligenceFixture();
    const model = buildProductIntelligence(
      fixture.report,
      fixture.products,
      fixture.listings,
      fixture.historicalSales,
    );

    assert.deepEqual(
      model.products.map(({ sku, abcClass, share, cumulativeShare }) => [
        sku,
        abcClass,
        share,
        cumulativeShare,
      ]),
      [
        ['SKU-1', 'A', 80, 80],
        ['SKU-2', 'B', 15, 95],
        ['SKU-3', 'C', 5, 100],
        ['SKU-4', 'C', 0, 100],
      ],
    );
    assert.deepEqual(
      model.rankings.overall.map(({ rank, sku }) => [rank, sku]),
      [[1, 'SKU-1'], [2, 'SKU-2'], [3, 'SKU-3'], [4, 'SKU-4']],
    );
    assert.deepEqual(
      model.rankings.c1.map(({ rank, sku, unitsSoldC1 }) => [
        rank,
        sku,
        unitsSoldC1,
      ]),
      [[1, 'SKU-1', 50], [2, 'SKU-2', 15], [3, 'SKU-4', 0]],
    );
    assert.deepEqual(
      model.rankings.c2.map(({ rank, sku, unitsSoldC2 }) => [
        rank,
        sku,
        unitsSoldC2,
      ]),
      [[1, 'SKU-1', 30], [2, 'SKU-3', 5]],
    );
    assert.equal(model.comparison.length, 1);
    assert.deepEqual(model.comparison[0], {
      productId: 'p1',
      sku: 'SKU-1',
      unitsC1: 50,
      unitsC2: 30,
      difference: 20,
      participationC1: 62.5,
      participationC2: 37.5,
      listingsC1: [listingReference('listing-p1-c1', 'MLB-P1-C1', 'SELL-P1-C1', 'SHARED')],
      listingsC2: [listingReference('listing-p1-c2', 'MLB-P1-C2', 'SELL-P1-C2', 'OTHER')],
    });
    assert.equal(
      model.comparison.some(({ productId }) => productId === 'p2' || productId === 'p3'),
      false,
      'equal sellerSku values must not create a C1 x C2 match',
    );
  });

  it('uses historical PAID sales for last sale and detects only active old zero-sale listings', () => {
    const fixture = intelligenceFixture();
    const model = buildProductIntelligence(
      fixture.report,
      fixture.products,
      fixture.listings,
      fixture.historicalSales,
    );

    const product2 = model.products.find(({ productId }) => productId === 'p2')!;
    assert.equal(product2.lastSaleAt, '2026-08-20T12:00:00.000Z');
    assert.equal(product2.daysWithoutSale, 40);

    assert.deepEqual(
      model.alerts.map(
        ({ listingId, productId, lastSaleAt, daysWithoutSale, status }) => ({
          listingId,
          productId,
          lastSaleAt,
          daysWithoutSale,
          status,
        }),
      ),
      [
        {
          listingId: 'MLB-UNKNOWN',
          productId: null,
          lastSaleAt: null,
          daysWithoutSale: 90,
          status: 'NO_SALE_30D',
        },
        {
          listingId: 'MLB-P1-C2',
          productId: 'p1',
          lastSaleAt: null,
          daysWithoutSale: 59,
          status: 'NO_SALE_30D',
        },
        {
          listingId: 'MLB-P2-C1',
          productId: 'p2',
          lastSaleAt: '2026-08-20T12:00:00.000Z',
          daysWithoutSale: 40,
          status: 'NO_SALE_30D',
        },
      ],
    );
    assert.equal(model.alerts.some(({ listingId }) => listingId === 'MLB-P1-C1'), false);
    assert.equal(model.alerts.some(({ listingId }) => listingId === 'MLB-YOUNG'), false);
    assert.equal(model.alerts.some(({ listingId }) => listingId === 'MLB-INACTIVE'), false);
  });

  it('puts the approved partial-coverage baseline on every API response', async () => {
    const fixture = intelligenceFixture();
    const database = {
      product: { findMany: async () => fixture.products },
      marketplaceListingItem: { findMany: async () => fixture.listings },
      marketplaceOrderItem: { findMany: async () => fixture.historicalSales },
    } as unknown as DatabaseService;
    const abc = {
      generate: async () => fixture.report,
    } as unknown as ProductSalesAbcService;
    const service = new ProductIntelligenceService(database, abc);

    const responses = await Promise.all([
      service.findProducts(),
      service.findRankings(),
      service.findComparison(),
      service.findNoSaleAlerts(),
    ]);

    for (const response of responses) {
      assert.equal(response.coveredPaidUnits, 3_538);
      assert.equal(response.totalPaidUnits, 6_712);
      assert.equal(response.coveragePercent, 52.71);
      assert.equal(response.metadata.readOnly, true);
      assert.equal(response.metadata.windowDays, 30);
    }
  });
});

function intelligenceFixture(): {
  report: ReturnType<typeof calculateProductSalesAbc>;
  products: ProductIntelligenceSourceProduct[];
  listings: ProductIntelligenceListingSource[];
  historicalSales: ProductIntelligenceHistoricalSale[];
} {
  const abcProducts = [
    abcProduct('p1', 'SKU-1', ['C1', 'C2']),
    abcProduct('p2', 'SKU-2', ['C1']),
    abcProduct('p3', 'SKU-3', ['C2']),
    abcProduct('p4', 'SKU-4', ['C1']),
  ];
  const sourceProducts = abcProducts.map(({ id, externalIdentities }) => ({
    id,
    externalIdentities,
  }));
  const report = calculateProductSalesAbc(
    abcSource(abcProducts, [
      abcItem('i1', 'o1', 50, 'p1', 'C1'),
      abcItem('i2', 'o2', 30, 'p1', 'C2'),
      abcItem('i3', 'o3', 15, 'p2', 'C1'),
      abcItem('i4', 'o4', 5, 'p3', 'C2'),
    ]),
  );
  const historicalSales = [
    historicalSale('h1', 'p1', '2026-09-28T12:00:00.000Z'),
    historicalSale('h2', 'p2', '2026-08-20T12:00:00.000Z'),
    historicalSale('h3', 'p3', '2026-09-10T12:00:00.000Z'),
  ];
  const listings = [
    listing('listing-p1-c1', 'p1', 'MLB-P1-C1', 'SELL-P1-C1', 'SHARED', 'C1', '2026-08-01', true, [
      { quantity: 1, marketplaceOrder: { soldAt: new Date('2026-09-28T12:00:00.000Z') } },
    ]),
    listing('listing-p1-c2', 'p1', 'MLB-P1-C2', 'SELL-P1-C2', 'OTHER', 'C2', '2026-08-01'),
    listing('listing-p2-c1', 'p2', 'MLB-P2-C1', 'SELL-P2-C1', 'DUPLICATE', 'C1', '2026-08-01', true, [
      { quantity: 1, marketplaceOrder: { soldAt: new Date('2026-08-20T12:00:00.000Z') } },
    ]),
    listing('listing-p3-c2', 'p3', 'MLB-YOUNG', 'SELL-P3-C2', 'DUPLICATE', 'C2', '2026-09-10'),
    listing('listing-p4-c1', 'p4', 'MLB-INACTIVE', 'SELL-P4-C1', 'SKU-4', 'C1', '2026-07-01', false),
    listing('listing-unknown', null, 'MLB-UNKNOWN', 'SELL-UNKNOWN', 'UNKNOWN', 'C2', '2026-07-01'),
  ];
  return { report, products: sourceProducts, listings, historicalSales };
}

function abcSource(
  products: ProductSalesAbcSourceProduct[],
  items: ProductSalesAbcSourceItem[],
): ProductSalesAbcSource {
  return {
    generatedAt: new Date('2026-10-02T12:00:00.000Z'),
    loadedFrom: new Date('2026-07-01T12:00:00.000Z'),
    loadedTo: WINDOW_TO,
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    windowDays: 30,
    businessTimeZone: 'America/Sao_Paulo',
    products,
    historicalItems: items.map(({ id, productId, quantity, marketplaceListingItem }) => ({
      id,
      productId,
      quantity,
      marketplaceListingItem,
    })),
    windowItems: items,
  };
}

function abcProduct(
  id: string,
  sku: string,
  accounts: string[],
): ProductSalesAbcSourceProduct {
  return {
    id,
    sku,
    name: `Product ${sku}`,
    externalIdentities: accounts.map((code) => ({
      validTo: null,
      businessAccount: { code },
    })),
  };
}

function abcItem(
  id: string,
  orderId: string,
  quantity: number,
  productId: string,
  accountCode: string,
): ProductSalesAbcSourceItem {
  return {
    id,
    productId,
    quantity,
    marketplaceListingItem: { productId },
    marketplaceOrder: {
      id: orderId,
      normalizedStatus: MarketplaceOrderStatus.PAID,
      soldAt: new Date('2026-09-28T12:00:00.000Z'),
      paidAmount: '10',
      refundedAmount: '0',
      marketplaceAccount: { businessAccount: { code: accountCode } },
    },
  };
}

function historicalSale(
  id: string,
  productId: string,
  soldAt: string,
): ProductIntelligenceHistoricalSale {
  return {
    id,
    productId,
    marketplaceListingItem: { productId },
    marketplaceOrder: { soldAt: new Date(soldAt) },
  };
}

function listing(
  id: string,
  productId: string | null,
  listingId: string,
  externalSellableId: string,
  sellerSku: string,
  account: string,
  createdAt: string,
  active = true,
  orderItems: ProductIntelligenceListingSource['orderItems'] = [],
): ProductIntelligenceListingSource {
  return {
    id,
    productId,
    externalSellableId,
    sellerSku,
    active,
    marketplaceListing: {
      externalListingId: listingId,
      createdAt: new Date(`${createdAt}T12:00:00.000Z`),
      marketplaceAccount: { businessAccount: { code: account } },
    },
    orderItems,
  };
}

function listingReference(
  listingItemId: string,
  listingId: string,
  externalSellableId: string,
  sellerSku: string,
) {
  return { listingId, listingItemId, externalSellableId, sellerSku, active: true };
}
