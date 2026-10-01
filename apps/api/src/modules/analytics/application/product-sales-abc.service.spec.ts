import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MarketplaceOrderStatus } from '@prisma/client';

import {
  calculateProductSalesAbc,
  ProductSalesAbcSource,
  ProductSalesAbcSourceItem,
  ProductSalesAbcSourceProduct,
} from './product-sales-abc.service.js';

const WINDOW_TO = new Date('2026-09-29T02:31:20.000Z');

describe('calculateProductSalesAbc', () => {
  it('assigns a boundary-crossing Product to the class it closes', () => {
    const products = [product('p1', 'SKU-1'), product('p2', 'SKU-2'), product('p3', 'SKU-3'), product('p4', 'SKU-4')];
    const report = calculateProductSalesAbc(source(products, [
      item('i1', 'o1', 79, 'p1'),
      item('i2', 'o2', 14, 'p2'),
      item('i3', 'o3', 5, 'p3'),
      item('i4', 'o4', 2, 'p4'),
    ]));

    assert.deepEqual(
      report.products.map(({ sku, abcClass }) => [sku, abcClass]),
      [['SKU-1', 'A'], ['SKU-2', 'A'], ['SKU-3', 'B'], ['SKU-4', 'C']],
    );
    assert.deepEqual(
      report.abcSummary.map(({ products: count, units }) => [count, units]),
      [[2, 93], [1, 5], [1, 2]],
    );
  });

  it('uses only PAID in the baseline and reports refunds separately', () => {
    const paid = item('paid', 'paid-order', 5, 'p1');
    const partial = item('partial', 'partial-order', 7, 'p1', {
      status: MarketplaceOrderStatus.PARTIALLY_REFUNDED,
      paidAmount: '70',
      refundedAmount: '20',
    });
    const cancelled = item('cancelled', 'cancelled-order', 3, 'p1', {
      status: MarketplaceOrderStatus.CANCELLED,
      paidAmount: '0',
      refundedAmount: '30',
    });
    const report = calculateProductSalesAbc(
      source([product('p1', 'SKU-1')], [paid, partial, cancelled]),
    );

    assert.equal(report.products[0]!.unitsSoldTotal, 5);
    assert.equal(report.products[0]!.paidOrders, 1);
    assert.equal(report.validSalesCoverage.unitsTotal, 5);
    assert.equal(
      report.statusImpact.find(({ status }) => status === MarketplaceOrderStatus.PARTIALLY_REFUNDED)!.units,
      7,
    );
    assert.equal(
      report.statusImpact.find(({ status }) => status === MarketplaceOrderStatus.PARTIALLY_REFUNDED)!.includedInBaseline,
      false,
    );
  });

  it('resolves Product directly first and then through MarketplaceListingItem', () => {
    const direct = item('direct', 'o1', 2, 'p1');
    const viaListing = item('listing', 'o2', 3, null, { listingProductId: 'p2' });
    const unresolved = item('unresolved', 'o3', 5, null);
    const report = calculateProductSalesAbc(
      source([product('p1', 'SKU-1'), product('p2', 'SKU-2')], [direct, viaListing, unresolved]),
    );

    assert.deepEqual(report.relationshipAudit, {
      resolvedByOrderItemProduct: 1,
      resolvedByListingItemProduct: 1,
      unresolvedItems: 1,
      conflictingProductLinks: 0,
    });
    assert.equal(report.historicalCoverage.itemsWithProduct, 2);
    assert.equal(report.historicalCoverage.itemsWithoutProduct, 1);
    assert.equal(report.historicalCoverage.unitsWithProduct, 5);
    assert.equal(report.historicalCoverage.unitsWithoutProduct, 5);
    assert.equal(report.historicalCoverage.unitCoveragePercentage, 50);
  });

  it('counts a paid order only once per Product and compares both accounts neutrally', () => {
    const shared = product('p1', 'SKU-1', ['C1', 'C2']);
    const report = calculateProductSalesAbc(source([shared], [
      item('i1', 'same-order', 2, 'p1', { accountCode: 'C1' }),
      item('i2', 'same-order', 4, 'p1', { accountCode: 'C1' }),
      item('i3', 'other-order', 2, 'p1', { accountCode: 'C2' }),
    ]));

    assert.equal(report.products[0]!.paidOrders, 2);
    assert.equal(report.products[0]!.unitsSoldC1, 6);
    assert.equal(report.products[0]!.unitsSoldC2, 2);
    assert.deepEqual(report.c1C2Comparison[0], {
      productId: 'p1',
      sku: 'SKU-1',
      name: 'Product SKU-1',
      unitsC1: 6,
      unitsC2: 2,
      absoluteDifference: 4,
      percentageDifference: 100,
      participationC1: 75,
      participationC2: 25,
    });
  });

  it('rejects conflicting direct and listing Product links', () => {
    const conflicting = item('i1', 'o1', 1, 'p1', { listingProductId: 'p2' });
    assert.throws(
      () => calculateProductSalesAbc(source([product('p1', 'SKU-1'), product('p2', 'SKU-2')], [conflicting])),
      /conflicting direct and listing Product links/i,
    );
  });
});

function source(
  products: ProductSalesAbcSourceProduct[],
  windowItems: ProductSalesAbcSourceItem[],
): ProductSalesAbcSource {
  return {
    generatedAt: new Date('2026-10-01T12:00:00.000Z'),
    loadedFrom: new Date('2026-08-30T03:26:10.000Z'),
    loadedTo: WINDOW_TO,
    windowFrom: new Date(WINDOW_TO.getTime() - 30 * 86_400_000),
    windowTo: WINDOW_TO,
    windowDays: 30,
    businessTimeZone: 'America/Sao_Paulo',
    products,
    historicalItems: windowItems.map(({ id, productId, quantity, marketplaceListingItem }) => ({
      id,
      productId,
      quantity,
      marketplaceListingItem,
    })),
    windowItems,
  };
}

function product(
  id: string,
  sku: string,
  accounts: string[] = ['C1'],
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

function item(
  id: string,
  orderId: string,
  quantity: number,
  productId: string | null,
  options: {
    status?: MarketplaceOrderStatus;
    listingProductId?: string | null;
    accountCode?: string;
    paidAmount?: string;
    refundedAmount?: string;
  } = {},
): ProductSalesAbcSourceItem {
  return {
    id,
    productId,
    quantity,
    marketplaceListingItem:
      options.listingProductId === undefined
        ? null
        : { productId: options.listingProductId },
    marketplaceOrder: {
      id: orderId,
      normalizedStatus: options.status ?? MarketplaceOrderStatus.PAID,
      soldAt: new Date('2026-09-28T12:00:00.000Z'),
      paidAmount: options.paidAmount ?? '10',
      refundedAmount: options.refundedAmount ?? '0',
      marketplaceAccount: {
        businessAccount: { code: options.accountCode ?? 'C1' },
      },
    },
  };
}
