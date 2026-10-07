import 'reflect-metadata';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Marketplace, MarketplaceOrderStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { X1ProductIntelligenceQueryDto } from '../http/x1-product-intelligence-query.dto.js';
import {
  buildX1Response,
  resolveX1Period,
  X1EquivalenceSource,
  X1OrderItemSource,
} from './x1-product-intelligence.service.js';

const NOW = new Date('2026-10-07T15:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';

describe('X1ProductIntelligenceService read model', () => {
  it('uses the last 30/60/90 closed Sao Paulo civil days and excludes today', () => {
    assert.deepEqual(
      [30, 60, 90].map((days) => {
        const period = resolveX1Period(days as 30 | 60 | 90, TIMEZONE, NOW);
        return [
          period.startLabel,
          period.endLabel,
          period.start.toISOString(),
          period.endExclusive.toISOString(),
        ];
      }),
      [
        ['2026-09-07', '2026-10-06', '2026-09-07T03:00:00.000Z', '2026-10-07T03:00:00.000Z'],
        ['2026-08-08', '2026-10-06', '2026-08-08T03:00:00.000Z', '2026-10-07T03:00:00.000Z'],
        ['2026-07-09', '2026-10-06', '2026-07-09T03:00:00.000Z', '2026-10-07T03:00:00.000Z'],
      ],
    );
  });

  it('validates days as the only supported 30/60/90 values', async () => {
    const valid = plainToInstance(X1ProductIntelligenceQueryDto, { days: '30' });
    const missing = plainToInstance(X1ProductIntelligenceQueryDto, {});
    const invalid = plainToInstance(X1ProductIntelligenceQueryDto, { days: '31' });

    assert.equal((await validate(valid)).length, 0);
    assert.deepEqual((await validate(missing)).map(({ property }) => property), ['days']);
    assert.deepEqual((await validate(invalid)).map(({ property }) => property), ['days']);
  });

  it('aggregates multiple variations and packs without double-counting a sale', () => {
    const equivalences = pairEquivalences('MLB-C1', 'MLB-C2', [
      { key: 'single', quantity: '1' },
      { key: 'pack', quantity: '4' },
    ]);
    const report = build(equivalences, [
      orderItem('C1-single', 'order-c1', 2, '10', MarketplaceOrderStatus.PAID),
      orderItem('C1-pack', 'order-c1', 1, '40', MarketplaceOrderStatus.SHIPPED),
      orderItem('C2-single', 'order-c2', 1, '12', MarketplaceOrderStatus.DELIVERED),
    ]);
    const pair = report.pairs[0]!;

    assert.equal(pair.c1.salesCount, 1);
    assert.equal(pair.c1.soldOfferUnits, 3);
    assert.equal(pair.c1.normalizedPhysicalUnits, '6');
    assert.equal(pair.c1.grossRevenue, '60.00');
    assert.equal(pair.c2.salesCount, 1);
    assert.equal(pair.c2.soldOfferUnits, 1);
    assert.equal(pair.c2.normalizedPhysicalUnits, '1');
    assert.equal(pair.c2.grossRevenue, '12.00');
    assert.deepEqual(pair.deltas.salesCount, { absolute: 0, percent: 0 });
    assert.deepEqual(pair.deltas.soldOfferUnits, { absolute: 2, percent: 200 });
    assert.deepEqual(pair.deltas.normalizedPhysicalUnits, { absolute: '5', percent: 500 });
    assert.deepEqual(pair.deltas.grossRevenue, { absolute: '48.00', percent: 400 });
    assert.equal(pair.components.length, 2);
    assert.equal(pair.consistencyError, false);
  });

  it('keeps all effective statuses and excludes pending, cancelled, refunded and unknown', () => {
    const equivalences = pairEquivalences('MLB-C1', 'MLB-C2', [
      { key: 'single', quantity: '1' },
    ]);
    const statuses = Object.values(MarketplaceOrderStatus);
    const report = build(
      equivalences,
      statuses.map((status, index) =>
        orderItem('C1-single', `order-${index}`, 1, '2', status),
      ),
    );

    assert.equal(report.pairs[0]?.c1.salesCount, 5);
    assert.equal(report.pairs[0]?.c1.soldOfferUnits, 5);
    assert.equal(report.pairs[0]?.c1.grossRevenue, '10.00');
    assert.deepEqual(report.metadata.saleDefinition.includedStatuses, [
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'PARTIALLY_REFUNDED',
    ]);
  });

  it('returns null percentages when C2 is zero and never declares a winner', () => {
    const report = build(
      pairEquivalences('MLB-C1', 'MLB-C2', [{ key: 'single', quantity: '2' }]),
      [orderItem('C1-single', 'order-c1', 3, '7.50', MarketplaceOrderStatus.PROCESSING)],
    );
    const pair = report.pairs[0]!;

    assert.equal(pair.c2.salesCount, 0);
    assert.equal(pair.c2.grossRevenue, '0.00');
    assert.equal(pair.deltas.salesCount.percent, null);
    assert.equal(pair.deltas.soldOfferUnits.percent, null);
    assert.equal(pair.deltas.normalizedPhysicalUnits.percent, null);
    assert.equal(pair.deltas.grossRevenue.percent, null);
    assert.equal('winner' in pair, false);
  });

  it('keeps a C2-only pair and a zeroed pair in the fully comparable response', () => {
    const c2Only = pairEquivalences('MLB-C1-ONLY-ZERO', 'MLB-C2-ONLY', [
      { key: 'single', quantity: '1' },
    ]);
    const zeroed = pairEquivalences('MLB-C1-ZERO', 'MLB-C2-ZERO', [
      { key: 'zero', quantity: '1' },
    ]);
    const report = build([...c2Only, ...zeroed], [
      orderItem('C2-single', 'order-c2', 2, '5', MarketplaceOrderStatus.PAID),
    ]);

    assert.equal(report.pairs.length, 2);
    assert.equal(report.pairs.find(({ c2 }) => c2.mlb === 'MLB-C2-ONLY')?.c2.soldOfferUnits, 2);
    assert.equal(report.pairs.find(({ c2 }) => c2.mlb === 'MLB-C2-ZERO')?.c1.salesCount, 0);
  });

  it('excludes a partially materialized MLB pair, including Branco/1300', () => {
    const partial = pairEquivalences(
      'MLB3414573257',
      'MLB5700878462',
      [{ key: 'preto-1305', quantity: '2' }],
      ['C1-preto-1305', 'C1-branco-1300'],
      ['C2-preto-1305', 'C2-branco-1300'],
    );
    const report = build(partial, [
      orderItem('C1-preto-1305', 'order-1', 1, '20', MarketplaceOrderStatus.PAID),
    ]);

    assert.equal(report.pairs.length, 0);
    assert.equal(report.coverage.confirmedEquivalences, 1);
    assert.equal(report.coverage.fullyComparableMlbPairs, 0);
    assert.equal(report.coverage.reviewRequiredMlbPairs, 1);
  });

  it('marks divergent OfferComposition quantities without dropping the pair', () => {
    const equivalences = pairEquivalences('MLB-C1', 'MLB-C2', [
      { key: 'pack', quantity: '4', c2Quantity: '5' },
    ]);
    const report = build(equivalences, []);

    assert.equal(report.pairs.length, 1);
    assert.equal(report.pairs[0]?.consistencyError, true);
    assert.equal(report.pairs[0]?.components[0]?.consistencyError, true);
  });

  it('exposes official MLB ABC class/rank independently for units and revenue', () => {
    const equivalences = pairEquivalences('MLB-C1', 'MLB-C2', [
      { key: 'single', quantity: '1' },
    ]);
    const report = build(equivalences, [], {
      c1Units: new Map([['MLB-C1', { class: 'A' as const, rank: 1 }]]),
      c1Revenue: new Map([['MLB-C1', { class: 'B' as const, rank: 4 }]]),
      c2Units: new Map([['MLB-C2', { class: 'C' as const, rank: 9 }]]),
      c2Revenue: new Map([['MLB-C2', { class: 'A' as const, rank: 2 }]]),
    });

    assert.deepEqual(report.pairs[0]?.c1.abc, {
      units: { class: 'A', rank: 1 },
      grossRevenue: { class: 'B', rank: 4 },
    });
    assert.deepEqual(report.pairs[0]?.c2.abc, {
      units: { class: 'C', rank: 9 },
      grossRevenue: { class: 'A', rank: 2 },
    });
  });
});

function build(
  equivalences: X1EquivalenceSource[],
  orderItems: X1OrderItemSource[],
  abc?: Parameters<typeof buildX1Response>[0]['abc'],
) {
  return buildX1Response({
    days: 30,
    timezone: TIMEZONE,
    now: NOW,
    period: resolveX1Period(30, TIMEZONE, NOW),
    equivalences,
    orderItems,
    abc,
  });
}

function pairEquivalences(
  c1Mlb: string,
  c2Mlb: string,
  variations: Array<{ key: string; quantity: string; c2Quantity?: string }>,
  c1ListingItemIds = variations.map(({ key }) => `C1-${key}`),
  c2ListingItemIds = variations.map(({ key }) => `C2-${key}`),
): X1EquivalenceSource[] {
  return variations.map(({ key, quantity, c2Quantity }) => ({
    componentSignature: `signature-${key}`,
    confidence: new Prisma.Decimal('0.99'),
    matchingVersion: 'test-matching-v1',
    leftListingItem: listingItem(
      `C1-${key}`,
      c1Mlb,
      'C1',
      c1ListingItemIds,
      quantity,
      key,
    ),
    rightListingItem: listingItem(
      `C2-${key}`,
      c2Mlb,
      'C2',
      c2ListingItemIds,
      c2Quantity ?? quantity,
      key,
    ),
  }));
}

function listingItem(
  id: string,
  mlb: string,
  account: 'C1' | 'C2',
  listingItemIds: string[],
  quantity: string,
  productKey: string,
): X1EquivalenceSource['leftListingItem'] {
  return {
    id,
    externalSellableId: `${id}-sellable`,
    offerCompositions: [{
      quantity: new Prisma.Decimal(quantity),
      componentProduct: {
        id: `product-${productKey}`,
        sku: `SKU-${productKey}`,
        name: `Product ${productKey}`,
      },
    }],
    marketplaceListing: {
      externalListingId: mlb,
      items: listingItemIds.map((listingItemId) => ({ id: listingItemId })),
      marketplaceAccount: {
        marketplace: Marketplace.MERCADO_LIVRE,
        businessAccount: { code: account },
      },
    },
  };
}

function orderItem(
  listingItemId: string,
  orderId: string,
  quantity: number,
  unitPrice: string,
  status: MarketplaceOrderStatus,
): X1OrderItemSource {
  return {
    marketplaceListingItemId: listingItemId,
    quantity,
    unitPrice: new Prisma.Decimal(unitPrice),
    marketplaceOrder: {
      id: orderId,
      soldAt: new Date('2026-09-20T12:00:00.000Z'),
      normalizedStatus: status,
    },
  };
}
