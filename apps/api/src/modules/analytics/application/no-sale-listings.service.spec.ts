import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MarketplaceOrderStatus, Prisma } from '@prisma/client';

import {
  buildNoSaleListings,
  NoSaleListingSource,
  NoSaleOrderItemSource,
} from './no-sale-listings.service.js';
import {
  NoSaleListingStatusFilter,
  NoSaleListingsAccount,
} from '../http/no-sale-listings-query.dto.js';

const NOW = new Date('2026-10-03T15:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';

describe('NoSaleListingsService read model', () => {
  it('classifies 30D, 60D and 90D while excluding recent sales and new listings', () => {
    const listings = [
      listing('MLB-RECENT', 'C1', 120, 'Venda recente'),
      listing('MLB-30', 'C1', 120, 'Sem venda 30 dias'),
      listing('MLB-60', 'C1', 120, 'Sem venda 60 dias'),
      listing('MLB-90', 'C1', 120, 'Sem venda 90 dias'),
      listing('MLB-YOUNG', 'C1', 29, 'Anúncio novo'),
    ];
    const orderItems = [
      sale('MLB-RECENT', 'C1', 2, MarketplaceOrderStatus.PAID),
      sale('MLB-30', 'C1', 30, MarketplaceOrderStatus.PAID),
      sale('MLB-60', 'C1', 60, MarketplaceOrderStatus.DELIVERED),
      sale('MLB-90', 'C1', 90, MarketplaceOrderStatus.PARTIALLY_REFUNDED),
    ];

    const report = build({ listings, orderItems });

    assert.deepEqual(
      report.listings.map(({ mlb, operationalStatus }) => [
        mlb,
        operationalStatus,
      ]),
      [
        ['MLB-90', 'NO_SALE_90D'],
        ['MLB-60', 'NO_SALE_60D'],
        ['MLB-30', 'NO_SALE_30D'],
      ],
    );
    assert.deepEqual(report.summary, {
      noSale30d: 3,
      noSale60d: 2,
      noSale90d: 1,
      potentialRevenueAtRisk: null,
      potentialRevenueAtRiskReason:
        'Sem base confiável aprovada para estimar faturamento potencial.',
    });
  });

  it('does not let an isolated cancellation mask the lack of an effective sale', () => {
    const report = build({
      listings: [listing('MLB-CANCELLED', 'C1', 80, null)],
      orderItems: [
        sale('MLB-CANCELLED', 'C1', 5, MarketplaceOrderStatus.CANCELLED),
      ],
    });

    assert.equal(report.total, 1);
    assert.equal(report.listings[0]?.lastSaleAt, null);
    assert.equal(report.listings[0]?.daysSinceLastSale, null);
    assert.equal(
      report.listings[0]?.operationalStatus,
      'NO_SALE_IN_AVAILABLE_HISTORY',
    );
    assert.equal(report.listings[0]?.title, null);
    assert.ok(
      report.metadata.saleDefinition.excludedStatuses.includes(
        MarketplaceOrderStatus.CANCELLED,
      ),
    );
  });

  it('keeps paused and inactive listings out of the default active alert', () => {
    const active = listing('MLB-ACTIVE', 'C1', 80, 'Ativo');
    const paused = { ...listing('MLB-PAUSED', 'C1', 80, 'Pausado'), status: 'paused' };
    const inactive = { ...listing('MLB-CLOSED', 'C1', 80, 'Fechado'), status: 'closed' };

    const report = build({ listings: [active, paused, inactive], orderItems: [] });

    assert.deepEqual(report.listings.map(({ mlb }) => mlb), ['MLB-ACTIVE']);
  });

  it('keeps C1 and C2 identities separate for the same MLB', () => {
    const report = build({
      account: NoSaleListingsAccount.All,
      listings: [
        listing('MLB-SHARED', 'C1', 70, 'Conta 1'),
        listing('MLB-SHARED', 'C2', 70, 'Conta 2'),
      ],
      orderItems: [
        sale('MLB-SHARED', 'C1', 2, MarketplaceOrderStatus.PAID),
      ],
    });

    assert.deepEqual(
      report.listings.map(({ account, mlb }) => [account, mlb]),
      [['C2', 'MLB-SHARED']],
    );
  });

  it('does not assert a 30-day alert when available history is insufficient', () => {
    const report = build({
      listings: [listing('MLB-SHORT-HISTORY', 'C1', 100, 'Histórico curto')],
      orderItems: [],
      coverageDays: 29,
    });

    assert.equal(report.total, 0);
    assert.equal(report.summary.noSale30d, 0);
    assert.equal(report.metadata.history[0]?.availableDays, 29);
  });

  it('uses Sao Paulo business dates at the UTC boundary', () => {
    const now = new Date('2026-10-03T02:00:00.000Z'); // 02/10 23:00 BRT
    const soldAt = new Date('2026-09-03T03:00:00.000Z'); // 03/09 00:00 BRT
    const report = build({
      now,
      listings: [listing('MLB-TZ', 'C1', 100, 'Fuso')],
      orderItems: [
        saleAt('MLB-TZ', 'C1', soldAt, MarketplaceOrderStatus.PAID),
      ],
    });

    assert.equal(report.total, 0, '29 business dates have elapsed, not 30');
  });

  it('filters 60D and 90D views cumulatively', () => {
    const listings = [
      listing('MLB-30', 'C1', 100, '30'),
      listing('MLB-60', 'C1', 100, '60'),
      listing('MLB-90', 'C1', 100, '90'),
    ];
    const orderItems = [
      sale('MLB-30', 'C1', 30, MarketplaceOrderStatus.PROCESSING),
      sale('MLB-60', 'C1', 60, MarketplaceOrderStatus.SHIPPED),
      sale('MLB-90', 'C1', 90, MarketplaceOrderStatus.DELIVERED),
    ];

    assert.deepEqual(
      build({ listings, orderItems, thresholdDays: 60 }).listings.map(
        ({ mlb }) => mlb,
      ),
      ['MLB-90', 'MLB-60'],
    );
    assert.deepEqual(
      build({ listings, orderItems, thresholdDays: 90 }).listings.map(
        ({ mlb }) => mlb,
      ),
      ['MLB-90'],
    );
  });
});

function build(options: {
  now?: Date;
  account?: NoSaleListingsAccount;
  thresholdDays?: 30 | 60 | 90;
  listings: NoSaleListingSource[];
  orderItems: NoSaleOrderItemSource[];
  coverageDays?: number;
}) {
  const now = options.now ?? NOW;
  const coverageDays = options.coverageDays ?? 94;
  return buildNoSaleListings({
    now,
    timezone: TIMEZONE,
    thresholdDays: options.thresholdDays ?? 30,
    account: options.account ?? NoSaleListingsAccount.C1,
    listingStatus: NoSaleListingStatusFilter.Active,
    listings: options.listings,
    orderItems: options.orderItems,
    coverage: ['C1', 'C2'].map((account) => ({
      account,
      from: daysBefore(now, coverageDays),
      through: now,
    })),
  });
}

function listing(
  mlb: string,
  account: string,
  ageDays: number,
  title: string | null,
): NoSaleListingSource {
  return {
    externalListingId: mlb,
    title,
    status: 'active',
    createdAt: daysBefore(NOW, ageDays),
    marketplaceAccount: { businessAccount: { code: account } },
  };
}

function sale(
  mlb: string,
  account: string,
  daysAgo: number,
  status: MarketplaceOrderStatus,
): NoSaleOrderItemSource {
  return saleAt(mlb, account, daysBefore(NOW, daysAgo), status);
}

function saleAt(
  mlb: string,
  account: string,
  soldAt: Date,
  status: MarketplaceOrderStatus,
): NoSaleOrderItemSource {
  return {
    externalListingId: mlb,
    quantity: 1,
    grossAmount: new Prisma.Decimal('99.90'),
    marketplaceOrder: {
      id: `${account}-${mlb}-${soldAt.toISOString()}`,
      normalizedStatus: status,
      soldAt,
      marketplaceAccount: { businessAccount: { code: account } },
    },
  };
}

function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86_400_000);
}
