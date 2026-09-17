import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigService } from '@nestjs/config';
import { MarketplaceOrderStatus, Prisma } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  DailySalesSummaryError,
  DailySalesSummaryService,
  localDayToUtcInterval,
} from './daily-sales-summary.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';

describe('DailySalesSummaryService', () => {
  it('summarizes orders, units, statuses and Decimal amounts without duplicating orders', async () => {
    const database = new InMemoryAnalyticsDatabase(
      [ACCOUNT_ID, SECOND_ACCOUNT_ID],
      [
        order('paid', ACCOUNT_ID, '2026-09-10T03:00:00.000Z', 'PAID', '0.10', [2, 3]),
        order('cancelled', ACCOUNT_ID, '2026-09-10T10:00:00.000Z', 'CANCELLED', '10.00', [1]),
        order('refunded', ACCOUNT_ID, '2026-09-10T11:00:00.000Z', 'REFUNDED', '5.00', [4]),
        order(
          'partially-refunded',
          ACCOUNT_ID,
          '2026-09-10T12:00:00.000Z',
          'PARTIALLY_REFUNDED',
          '0.20',
          [2],
        ),
        order('shipped', ACCOUNT_ID, '2026-09-11T02:59:59.999Z', 'SHIPPED', '0.30', [1]),
        order('other-account', SECOND_ACCOUNT_ID, '2026-09-10T12:00:00.000Z', 'PAID', '999.99', [99]),
        order('next-day', ACCOUNT_ID, '2026-09-11T03:00:00.000Z', 'PAID', '100.00', [10]),
      ],
    );

    const summary = await makeService(database).summarize({
      marketplaceAccountId: ACCOUNT_ID,
      date: '2026-09-10',
    });

    assert.equal(summary.date, '2026-09-10');
    assert.equal(summary.marketplaceAccountId, ACCOUNT_ID);
    assert.equal(summary.currency, 'BRL');
    assert.equal(summary.totalOrders, 5);
    assert.equal(summary.totalUnits, 13);
    assert.equal(summary.cancelledOrders, 1);
    assert.equal(summary.refundedOrders, 1);
    assert.equal(summary.partiallyRefundedOrders, 1);
    assertDecimal(summary.marketplaceGrossAmount, '15.6');
    assertDecimal(summary.cancelledGrossAmount, '10');
    assertDecimal(summary.nonCancelledGrossAmount, '0.6');
    assertDecimal(summary.averageTicket, '0.2');
    assert.deepEqual(
      summary.statusBreakdown.map((row) => [
        row.status,
        row.orders,
        row.grossAmount.toString(),
      ]),
      [
        ['PAID', 1, '0.1'],
        ['SHIPPED', 1, '0.3'],
        ['CANCELLED', 1, '10'],
        ['PARTIALLY_REFUNDED', 1, '0.2'],
        ['REFUNDED', 1, '5'],
      ],
    );
  });

  it('returns an empty summary with Decimal zero for a day without orders', async () => {
    const database = new InMemoryAnalyticsDatabase([ACCOUNT_ID], []);

    const summary = await makeService(database).summarize({
      marketplaceAccountId: ACCOUNT_ID,
      date: '2026-09-10',
    });

    assert.equal(summary.currency, null);
    assert.equal(summary.totalOrders, 0);
    assert.equal(summary.totalUnits, 0);
    assert.equal(summary.cancelledOrders, 0);
    assert.equal(summary.refundedOrders, 0);
    assert.equal(summary.partiallyRefundedOrders, 0);
    assertDecimal(summary.marketplaceGrossAmount, '0');
    assertDecimal(summary.cancelledGrossAmount, '0');
    assertDecimal(summary.nonCancelledGrossAmount, '0');
    assertDecimal(summary.averageTicket, '0');
    assert.deepEqual(summary.statusBreakdown, []);
  });

  it('uses Decimal zero when only cancelled and refunded orders exist', async () => {
    const database = new InMemoryAnalyticsDatabase(
      [ACCOUNT_ID],
      [
        order('cancelled', ACCOUNT_ID, '2026-09-10T10:00:00.000Z', 'CANCELLED', '12.34', [1]),
        order('refunded', ACCOUNT_ID, '2026-09-10T11:00:00.000Z', 'REFUNDED', '56.78', [1]),
      ],
    );

    const summary = await makeService(database).summarize({
      marketplaceAccountId: ACCOUNT_ID,
      date: '2026-09-10',
    });

    assertDecimal(summary.nonCancelledGrossAmount, '0');
    assertDecimal(summary.averageTicket, '0');
  });

  it('converts local day boundaries to UTC with the configured timezone and DST', () => {
    const saoPaulo = localDayToUtcInterval(
      '2026-09-10',
      'America/Sao_Paulo',
    );
    assert.equal(saoPaulo.start.toISOString(), '2026-09-10T03:00:00.000Z');
    assert.equal(saoPaulo.end.toISOString(), '2026-09-11T03:00:00.000Z');

    const newYorkDstChange = localDayToUtcInterval(
      '2026-03-08',
      'America/New_York',
    );
    assert.equal(
      newYorkDstChange.start.toISOString(),
      '2026-03-08T05:00:00.000Z',
    );
    assert.equal(
      newYorkDstChange.end.toISOString(),
      '2026-03-09T04:00:00.000Z',
    );
  });

  it('rejects invalid calendar dates, missing accounts and mixed currencies', async () => {
    const database = new InMemoryAnalyticsDatabase(
      [ACCOUNT_ID],
      [
        order('brl', ACCOUNT_ID, '2026-09-10T10:00:00.000Z', 'PAID', '1.00', [1]),
        { ...order('usd', ACCOUNT_ID, '2026-09-10T11:00:00.000Z', 'PAID', '1.00', [1]), currency: 'USD' },
      ],
    );
    const service = makeService(database);

    await assertSummaryError(
      service.summarize({ marketplaceAccountId: ACCOUNT_ID, date: '2026-02-30' }),
      'INVALID_DATE',
    );
    await assertSummaryError(
      service.summarize({ marketplaceAccountId: SECOND_ACCOUNT_ID, date: '2026-09-10' }),
      'ACCOUNT_NOT_FOUND',
    );
    await assertSummaryError(
      service.summarize({ marketplaceAccountId: ACCOUNT_ID, date: '2026-09-10' }),
      'MIXED_CURRENCIES',
    );
  });
});

interface StoredOrder {
  id: string;
  marketplaceAccountId: string;
  soldAt: Date;
  normalizedStatus: MarketplaceOrderStatus;
  currency: string;
  grossAmount: Prisma.Decimal;
  itemQuantities: number[];
}

interface OrderWhere {
  marketplaceAccountId: string;
  soldAt: { gte: Date; lt: Date };
}

class InMemoryAnalyticsDatabase {
  constructor(
    private readonly accountIds: string[],
    private readonly orders: StoredOrder[],
  ) {}

  readonly marketplaceAccount = {
    findUnique: async (args: { where: { id: string } }) =>
      this.accountIds.includes(args.where.id) ? { id: args.where.id } : null,
  };

  readonly marketplaceOrder = {
    findMany: async (args: { where: OrderWhere }) =>
      this.orders
        .filter((storedOrder) => matches(storedOrder, args.where))
        .map((storedOrder) => ({
          normalizedStatus: storedOrder.normalizedStatus,
          currency: storedOrder.currency,
          grossAmount: storedOrder.grossAmount,
        })),
  };

  readonly marketplaceOrderItem = {
    aggregate: async (args: {
      where: { marketplaceOrder: { is: OrderWhere } };
    }) => ({
      _sum: {
        quantity: this.orders
          .filter((storedOrder) =>
            matches(storedOrder, args.where.marketplaceOrder.is),
          )
          .flatMap((storedOrder) => storedOrder.itemQuantities)
          .reduce((total, quantity) => total + quantity, 0),
      },
    }),
  };
}

function makeService(
  database: InMemoryAnalyticsDatabase,
  timeZone = 'America/Sao_Paulo',
): DailySalesSummaryService {
  const config = {
    get: () => timeZone,
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new DailySalesSummaryService(
    database as unknown as DatabaseService,
    config,
  );
}

function order(
  id: string,
  marketplaceAccountId: string,
  soldAt: string,
  normalizedStatus: MarketplaceOrderStatus,
  grossAmount: string,
  itemQuantities: number[],
): StoredOrder {
  return {
    id,
    marketplaceAccountId,
    soldAt: new Date(soldAt),
    normalizedStatus,
    currency: 'BRL',
    grossAmount: new Prisma.Decimal(grossAmount),
    itemQuantities,
  };
}

function matches(order: StoredOrder, where: OrderWhere): boolean {
  return (
    order.marketplaceAccountId === where.marketplaceAccountId &&
    order.soldAt >= where.soldAt.gte &&
    order.soldAt < where.soldAt.lt
  );
}

function assertDecimal(actual: Prisma.Decimal, expected: string): void {
  assert.ok(actual instanceof Prisma.Decimal);
  assert.equal(actual.toString(), expected);
}

async function assertSummaryError(
  promise: Promise<unknown>,
  code: DailySalesSummaryError['code'],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DailySalesSummaryError);
    assert.equal(error.code, code);
    return true;
  });
}
