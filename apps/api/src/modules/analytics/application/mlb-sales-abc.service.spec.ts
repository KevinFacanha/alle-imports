import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplaceOrderStatus, Prisma } from '@prisma/client';
import { validate } from 'class-validator';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  MlbSalesAbcMetric,
  MlbSalesAbcQueryDto,
  MlbSalesAbcScope,
} from '../http/mlb-sales-abc-query.dto.js';
import {
  calculateMlbSalesAbc,
  compareMlbSalesAbc,
  MlbAbcClass,
  MlbAbcClassTransition,
  MlbAbcMovement,
  MlbSalesAbcService,
  MlbSalesAbcSourceItem,
  resolveMlbAbcPeriod,
} from './mlb-sales-abc.service.js';

describe('MlbSalesAbcService', () => {
  it('uses inclusive start, exclusive end and Sao Paulo civil boundaries', async () => {
    const database = new MlbAbcDatabase([]);
    const result = await service(database).find(request());

    assert.equal(result.timezone, 'America/Sao_Paulo');
    assert.equal(result.periodStart, '2026-09-01');
    assert.equal(result.periodEnd, '2026-10-01');
    assert.deepEqual(soldAtFilter(database.calls[0]), {
      gte: new Date('2026-08-31T03:00:00.000Z'),
      lt: new Date('2026-10-01T03:00:00.000Z'),
    });
    assert.equal(JSON.stringify(database.calls[0]).includes('lte'), false);
  });

  it('resolves dynamic 30/60/90-day windows in America/Sao_Paulo', () => {
    const nearUtcMidnight = new Date('2026-10-04T01:30:00.000Z');

    assert.deepEqual(
      [30, 60, 90].map((days) =>
        resolveMlbAbcPeriod(
          request({ start: undefined, end: undefined, days: days as 30 | 60 | 90 }),
          'America/Sao_Paulo',
          nearUtcMidnight,
        ),
      ),
      [
        { start: '2026-09-04', end: '2026-10-04', scope: 'C1', metric: 'UNITS' },
        { start: '2026-08-05', end: '2026-10-04', scope: 'C1', metric: 'UNITS' },
        { start: '2026-07-06', end: '2026-10-04', scope: 'C1', metric: 'UNITS' },
      ],
    );
  });

  it('queries a dynamic window with inclusive start and exclusive next-day end', async () => {
    const database = new MlbAbcDatabase([]);
    const dynamic = resolveMlbAbcPeriod(
      request({ start: undefined, end: undefined, days: 30 }),
      'America/Sao_Paulo',
      new Date('2026-10-03T15:00:00.000Z'),
    );
    await service(database).find(dynamic);

    assert.deepEqual(soldAtFilter(database.calls[0]), {
      gte: new Date('2026-09-03T03:00:00.000Z'),
      lt: new Date('2026-10-04T03:00:00.000Z'),
    });
  });

  it('compares the same window shifted exactly one Sao Paulo civil day', async () => {
    const database = new MlbAbcDatabase([
      item('MLB-PREVIOUS', 'v1', 'o1', 10, '1', undefined, {
        soldAt: new Date('2026-08-31T12:00:00.000Z'),
      }),
      item('MLB-SHARED', 'v2', 'o2', 5, '1', undefined, {
        soldAt: new Date('2026-09-15T12:00:00.000Z'),
      }),
      item('MLB-CURRENT', 'v3', 'o3', 3, '1', undefined, {
        soldAt: new Date('2026-09-30T12:00:00.000Z'),
      }),
    ]);

    const result = await service(database).find(request());

    assert.equal(result.previousPeriodStart, '2026-08-31');
    assert.equal(result.previousPeriodEnd, '2026-09-30');
    assert.equal(result.mlbs.some(({ mlb }) => mlb === 'MLB-PREVIOUS'), false);
    assert.equal(
      result.mlbs.find(({ mlb }) => mlb === 'MLB-CURRENT')?.movement,
      'NEW',
    );
    assert.notEqual(
      result.mlbs.find(({ mlb }) => mlb === 'MLB-SHARED')?.previousClass,
      null,
    );
  });

  it('explains the delta with the revenue and units entering and leaving the window', async () => {
    const database = new MlbAbcDatabase([
      item('MLB-SHARED', 'leaving', 'o1', 2, '10', undefined, {
        soldAt: new Date('2026-08-31T12:00:00.000Z'),
      }),
      item('MLB-SHARED', 'overlap', 'o2', 10, '10', undefined, {
        soldAt: new Date('2026-09-15T12:00:00.000Z'),
      }),
      item('MLB-SHARED', 'entering', 'o3', 3, '10', undefined, {
        soldAt: new Date('2026-09-30T12:00:00.000Z'),
      }),
    ]);

    const compared = (await service(database).find(request())).mlbs[0]!;

    assert.equal(compared.previousGrossRevenue, '120.00');
    assert.equal(compared.currentGrossRevenue, '130.00');
    assert.equal(compared.grossRevenueDelta, '10.00');
    assert.equal(compared.revenueLeavingWindow, '20.00');
    assert.equal(compared.revenueEnteringWindow, '30.00');
    assert.equal(compared.previousUnits, 12);
    assert.equal(compared.currentUnits, 13);
    assert.equal(compared.unitsDelta, 1);
    assert.equal(compared.unitsLeavingWindow, 2);
    assert.equal(compared.unitsEnteringWindow, 3);
    assert.equal(database.calls.length, 1);
  });

  it('scopes C1, C2 and consolidated reads without filtering order status', async () => {
    const database = new MlbAbcDatabase([]);
    const queryService = service(database);

    await queryService.find(request({ scope: MlbSalesAbcScope.C1 }));
    await queryService.find(request({ scope: MlbSalesAbcScope.C2 }));
    await queryService.find(request({ scope: MlbSalesAbcScope.Consolidated }));

    assert.deepEqual(accountCodes(database.calls[0]), ['C1']);
    assert.deepEqual(accountCodes(database.calls[1]), ['C2']);
    assert.deepEqual(accountCodes(database.calls[2]), ['C1', 'C2']);
    for (const call of database.calls) {
      assert.equal(JSON.stringify(call).includes('normalizedStatus'), false);
    }
  });

  it('returns the parent listing title by BusinessAccount + MLB and sync timestamps', async () => {
    const lastUpdatedAt = new Date('2026-10-03T14:00:00.000Z');
    const lastSyncedAt = new Date('2026-10-03T14:05:00.000Z');
    const database = new MlbAbcDatabase(
      [
        item('MLB1', 'variation-a', 'order-1', 1, '10'),
        item('MLB1', 'variation-b', 'order-2', 1, '10'),
        item('MLB2', 'variation-c', 'order-3', 1, '10'),
      ],
      [{ externalListingId: 'MLB1', title: 'Anúncio pai', account: 'C1' }],
      lastUpdatedAt,
      lastSyncedAt,
    );

    const result = await service(database).find(request());

    assert.equal(result.mlbs.find(({ mlb }) => mlb === 'MLB1')?.title, 'Anúncio pai');
    assert.equal(result.mlbs.find(({ mlb }) => mlb === 'MLB2')?.title, null);
    assert.equal(result.lastUpdatedAt, lastUpdatedAt.toISOString());
    assert.equal(result.lastSyncedAt, lastSyncedAt.toISOString());
  });

  it('rejects invalid or reversed civil periods', async () => {
    const queryService = service(new MlbAbcDatabase([]));
    await assert.rejects(
      queryService.find(request({ start: '2026-09-31' })),
      BadRequestException,
    );
    await assert.rejects(
      queryService.find(request({ start: '2026-10-01', end: '2026-10-01' })),
      /start must be earlier than end/,
    );
  });

  it('validates the endpoint query contract', async () => {
    const invalid = Object.assign(new MlbSalesAbcQueryDto(), {
      start: '01-09-2026',
      end: '2026-10-01T00:00:00Z',
      scope: 'ALL',
      metric: 'REVENUE',
    });
    assert.deepEqual(
      (await validate(invalid)).map(({ property }) => property).sort(),
      ['end', 'metric', 'scope', 'start'],
    );
  });
});

describe('calculateMlbSalesAbc', () => {
  it('sums variations by MLB, counts each sale once and ignores item grossAmount', () => {
    const report = calculate([
      item('MLB1', 'variation-a', 'order-1', 2, '9.50', '999.00'),
      item('MLB1', 'variation-b', 'order-1', 3, '10.00', '999.00'),
      item('MLB1', 'variation-c', 'order-2', 1, '5.25', '999.00'),
    ]);

    assert.equal(report.totalSales, 2);
    assert.equal(report.totalUnits, 6);
    assert.equal(report.totalGrossRevenue, '54.25');
    assert.equal(report.totalMlbs, 1);
    assert.deepEqual(report.mlbs[0], {
      mlb: 'MLB1',
      title: null,
      account: 'C1',
      salesCount: 2,
      unitsSold: 6,
      grossRevenue: '54.25',
      participationPercent: 100,
      cumulativePercent: 100,
      abcClass: 'A',
      rank: 1,
    });
  });

  it('returns one parent title for all variations of the same MLB', () => {
    const first = item('MLB1', 'variation-a', 'order-1', 1, '10');
    const second = item('MLB1', 'variation-b', 'order-2', 1, '10');
    first.listingTitle = 'Título do anúncio-pai';
    second.listingTitle = 'Título do anúncio-pai';

    assert.equal(calculate([first, second]).mlbs[0]?.title, 'Título do anúncio-pai');
  });

  it('includes every persisted order status', () => {
    const items = Object.values(MarketplaceOrderStatus).map((status, index) =>
      item('MLB1', `variation-${index}`, `order-${index}`, 1, '1.00', '0', {
        status,
      }),
    );
    const report = calculate(items);

    assert.equal(report.totalSales, Object.values(MarketplaceOrderStatus).length);
    assert.equal(report.totalUnits, Object.values(MarketplaceOrderStatus).length);
    assert.equal(
      report.totalGrossRevenue,
      `${Object.values(MarketplaceOrderStatus).length}.00`,
    );
  });

  it('keeps boundary-crossing MLBs in the previous 80/15/5 class', () => {
    const report = calculate([
      item('MLB1', 'v1', 'o1', 79, '1'),
      item('MLB2', 'v2', 'o2', 14, '1'),
      item('MLB3', 'v3', 'o3', 5, '1'),
      item('MLB4', 'v4', 'o4', 2, '1'),
    ]);

    assert.deepEqual(
      report.mlbs.map(({ mlb, abcClass, cumulativePercent }) => [
        mlb,
        abcClass,
        cumulativePercent,
      ]),
      [
        ['MLB1', 'A', 79],
        ['MLB2', 'A', 93],
        ['MLB3', 'B', 98],
        ['MLB4', 'C', 100],
      ],
    );
  });

  it('ranks by gross revenue when requested while retaining both metrics', () => {
    const report = calculate(
      [
        item('MLB-UNITS', 'v1', 'o1', 10, '1.00'),
        item('MLB-REVENUE', 'v2', 'o2', 1, '50.00'),
      ],
      { metric: MlbSalesAbcMetric.GrossRevenue },
    );

    assert.deepEqual(report.mlbs.map(({ mlb }) => mlb), [
      'MLB-REVENUE',
      'MLB-UNITS',
    ]);
    assert.equal(report.mlbs[0]?.unitsSold, 1);
    assert.equal(report.mlbs[0]?.grossRevenue, '50.00');
  });

  it('uses MLB ascending as a deterministic metric tie-breaker', () => {
    const report = calculate([
      item('MLB20', 'v1', 'o1', 5, '1'),
      item('MLB03', 'v2', 'o2', 5, '1'),
      item('MLB10', 'v3', 'o3', 5, '1'),
    ]);

    assert.deepEqual(report.mlbs.map(({ mlb, rank }) => [mlb, rank]), [
      ['MLB03', 1],
      ['MLB10', 2],
      ['MLB20', 3],
    ]);
  });

  it('reports C1, C2 and consolidated account totals independently', () => {
    const c1 = item('MLB1', 'v1', 'c1-order', 2, '10', '20', { account: 'C1' });
    const c2 = item('MLB2', 'v2', 'c2-order', 3, '20', '60', { account: 'C2' });

    const c1Report = calculate([c1], { scope: MlbSalesAbcScope.C1 });
    const c2Report = calculate([c2], { scope: MlbSalesAbcScope.C2 });
    const consolidated = calculate([c1, c2], {
      scope: MlbSalesAbcScope.Consolidated,
    });

    assert.deepEqual(
      [c1Report, c2Report, consolidated].map((report) => ({
        scope: report.scope,
        sales: report.totalSales,
        units: report.totalUnits,
        revenue: report.totalGrossRevenue,
        mlbs: report.totalMlbs,
      })),
      [
        { scope: 'C1', sales: 1, units: 2, revenue: '20.00', mlbs: 1 },
        { scope: 'C2', sales: 1, units: 3, revenue: '60.00', mlbs: 1 },
        {
          scope: 'CONSOLIDATED',
          sales: 2,
          units: 5,
          revenue: '80.00',
          mlbs: 2,
        },
      ],
    );
  });
});

describe('compareMlbSalesAbc', () => {
  it('classifies A→B, A→C and B→C as declined', () => {
    assertMovement('A', 'B', 'DECLINED', 'A_TO_B');
    assertMovement('A', 'C', 'DECLINED', 'A_TO_C');
    assertMovement('B', 'C', 'DECLINED', 'B_TO_C');
  });

  it('classifies B→A, C→B and C→A as improved', () => {
    assertMovement('B', 'A', 'IMPROVED', 'B_TO_A');
    assertMovement('C', 'B', 'IMPROVED', 'C_TO_B');
    assertMovement('C', 'A', 'IMPROVED', 'C_TO_A');
  });

  it('classifies same-class MLBs as stable and missing previous MLBs as new', () => {
    assertMovement('A', 'A', 'STABLE', 'A_TO_A');
    const comparison = compareMlbSalesAbc(calculate([item('MLB-NEW', 'v', 'o', 1, '1')]), calculate([]));
    const added = comparison.mlbs[0]!;

    assert.equal(added.movement, 'NEW');
    assert.equal(added.previousClass, null);
    assert.equal(added.classTransition, null);
    assert.equal(added.previousRank, null);
    assert.equal(added.rankDelta, null);
    assert.equal(added.unitsDelta, 1);
    assert.equal(added.unitsDeltaPercent, null);
    assert.equal(added.grossRevenueDelta, '1.00');
    assert.equal(added.grossRevenueDeltaPercent, null);
    assert.equal(added.revenueMovement, 'NEW');
  });

  it('returns rank and metric deltas with null percentage for zero denominators', () => {
    const previous = calculate([item('MLB1', 'v1', 'o1', 0, '0')]);
    const current = calculate([item('MLB1', 'v1', 'o1', 2, '12.50')]);
    const compared = compareMlbSalesAbc(current, previous).mlbs[0]!;

    assert.equal(compared.currentRank, 1);
    assert.equal(compared.previousRank, 1);
    assert.equal(compared.rankDelta, 0);
    assert.equal(compared.currentUnits, 2);
    assert.equal(compared.previousUnits, 0);
    assert.equal(compared.unitsDelta, 2);
    assert.equal(compared.unitsDeltaPercent, null);
    assert.equal(compared.currentGrossRevenue, '25.00');
    assert.equal(compared.previousGrossRevenue, '0.00');
    assert.equal(compared.grossRevenueDelta, '25.00');
    assert.equal(compared.grossRevenueDeltaPercent, null);
    assert.equal(compared.revenueMovement, 'INCREASED');
  });

  it('classifies positive, negative and zero revenue deltas independently', () => {
    const previous = calculate([
      item('MLB-GAIN', 'v1', 'o1', 1, '10'),
      item('MLB-LOSS', 'v2', 'o2', 1, '100'),
      item('MLB-STABLE', 'v3', 'o3', 1, '25'),
    ]);
    const current = calculate([
      item('MLB-GAIN', 'v1', 'o1', 1, '50'),
      item('MLB-LOSS', 'v2', 'o2', 1, '40'),
      item('MLB-STABLE', 'v3', 'o3', 1, '25'),
    ]);
    const result = compareMlbSalesAbc(current, previous);
    const byMlb = new Map(result.mlbs.map((entry) => [entry.mlb, entry]));

    assert.deepEqual(
      ['MLB-GAIN', 'MLB-LOSS', 'MLB-STABLE'].map((mlb) => ({
        mlb,
        movement: byMlb.get(mlb)?.revenueMovement,
        delta: byMlb.get(mlb)?.grossRevenueDelta,
      })),
      [
        { mlb: 'MLB-GAIN', movement: 'INCREASED', delta: '40.00' },
        { mlb: 'MLB-LOSS', movement: 'DECREASED', delta: '-60.00' },
        { mlb: 'MLB-STABLE', movement: 'STABLE', delta: '0.00' },
      ],
    );
    assert.equal(result.movementSummary.revenueIncreased, 1);
    assert.equal(result.movementSummary.revenueDecreased, 1);
    assert.equal(result.movementSummary.grossRevenueGain, '40.00');
    assert.equal(result.movementSummary.grossRevenueLoss, '60.00');
  });

  it('keeps ABC and revenue movements independent', () => {
    const scenarios = [
      { previousClass: 'A', currentClass: 'A', previousPrice: '10', currentPrice: '5', expected: 'DECREASED' },
      { previousClass: 'B', currentClass: 'A', previousPrice: '1', currentPrice: '2', expected: 'INCREASED' },
      { previousClass: 'A', currentClass: 'B', previousPrice: '1', currentPrice: '20', expected: 'INCREASED' },
      { previousClass: 'B', currentClass: 'C', previousPrice: '10', currentPrice: '25', expected: 'STABLE' },
    ] as const;

    for (const scenario of scenarios) {
      const previousItems = classifiedItems('MLB-TARGET', scenario.previousClass);
      const currentItems = classifiedItems('MLB-TARGET', scenario.currentClass);
      previousItems.find((entry) => entry.externalListingId === 'MLB-TARGET')!.unitPrice = new Prisma.Decimal(scenario.previousPrice);
      currentItems.find((entry) => entry.externalListingId === 'MLB-TARGET')!.unitPrice = new Prisma.Decimal(scenario.currentPrice);
      const target = compareMlbSalesAbc(
        calculate(currentItems),
        calculate(previousItems),
      ).mlbs.find((entry) => entry.mlb === 'MLB-TARGET');

      assert.equal(target?.previousClass, scenario.previousClass);
      assert.equal(target?.currentClass, scenario.currentClass);
      assert.equal(target?.revenueMovement, scenario.expected);
    }
  });

  it('uses the selected Units or Gross Revenue ABC classification in comparisons', () => {
    const source = [
      item('MLB-HIGH-UNITS', 'v1', 'o1', 10, '1'),
      item('MLB-HIGH-REVENUE', 'v2', 'o2', 1, '100'),
    ];
    const units = calculate(source, { metric: MlbSalesAbcMetric.Units });
    const revenue = calculate(source, { metric: MlbSalesAbcMetric.GrossRevenue });

    assert.equal(units.mlbs[0]?.mlb, 'MLB-HIGH-UNITS');
    assert.equal(revenue.mlbs[0]?.mlb, 'MLB-HIGH-REVENUE');
    assert.equal(compareMlbSalesAbc(units, units).mlbs[0]?.movement, 'STABLE');
    assert.equal(compareMlbSalesAbc(revenue, revenue).mlbs[0]?.movement, 'STABLE');
  });
});

function request(
  overrides: Partial<Parameters<MlbSalesAbcService['find']>[0]> = {},
): Parameters<MlbSalesAbcService['find']>[0] {
  return {
    start: '2026-09-01',
    end: '2026-10-01',
    scope: MlbSalesAbcScope.C1,
    metric: MlbSalesAbcMetric.Units,
    ...overrides,
  };
}

function calculate(
  items: MlbSalesAbcSourceItem[],
  overrides: Partial<Parameters<typeof calculateMlbSalesAbc>[0]> = {},
) {
  return calculateMlbSalesAbc({
    start: '2026-09-01',
    end: '2026-10-01',
    scope: MlbSalesAbcScope.C1,
    metric: MlbSalesAbcMetric.Units,
    timezone: 'America/Sao_Paulo',
    items,
    ...overrides,
  });
}

function assertMovement(
  previousClass: MlbAbcClass,
  currentClass: MlbAbcClass,
  expectedMovement: MlbAbcMovement,
  expectedTransition: MlbAbcClassTransition,
): void {
  const previous = calculate(classifiedItems('MLB-TARGET', previousClass));
  const current = calculate(classifiedItems('MLB-TARGET', currentClass));
  const target = compareMlbSalesAbc(current, previous).mlbs.find(
    ({ mlb }) => mlb === 'MLB-TARGET',
  );

  assert.equal(target?.previousClass, previousClass);
  assert.equal(target?.currentClass, currentClass);
  assert.equal(target?.movement, expectedMovement);
  assert.equal(target?.classTransition, expectedTransition);
}

function classifiedItems(
  targetMlb: string,
  abcClass: MlbAbcClass,
): MlbSalesAbcSourceItem[] {
  if (abcClass === 'A') {
    return [
      item(targetMlb, 'target', 'target-order', 79, '1'),
      item('MLB-FILL-2', 'v2', 'o2', 14, '1'),
      item('MLB-FILL-3', 'v3', 'o3', 5, '1'),
      item('MLB-FILL-4', 'v4', 'o4', 2, '1'),
    ];
  }
  if (abcClass === 'B') {
    return [
      item('MLB-FILL-1', 'v1', 'o1', 79, '1'),
      item('MLB-FILL-2', 'v2', 'o2', 14, '1'),
      item(targetMlb, 'target', 'target-order', 5, '1'),
      item('MLB-FILL-4', 'v4', 'o4', 2, '1'),
    ];
  }
  return [
    item('MLB-FILL-1', 'v1', 'o1', 79, '1'),
    item('MLB-FILL-2', 'v2', 'o2', 14, '1'),
    item('MLB-FILL-3', 'v3', 'o3', 5, '1'),
    item(targetMlb, 'target', 'target-order', 2, '1'),
  ];
}

function item(
  externalListingId: string,
  externalSellableId: string,
  orderId: string,
  quantity: number,
  unitPrice: string,
  grossAmount = new Prisma.Decimal(unitPrice).mul(quantity).toString(),
  options: {
    account?: string;
    status?: MarketplaceOrderStatus;
    soldAt?: Date;
  } = {},
): MlbSalesAbcSourceItem & { externalSellableId: string } {
  return {
    externalListingId,
    externalSellableId,
    quantity,
    unitPrice: new Prisma.Decimal(unitPrice),
    grossAmount: new Prisma.Decimal(grossAmount),
    marketplaceOrder: {
      id: orderId,
      soldAt: options.soldAt ?? new Date('2026-09-15T12:00:00.000Z'),
      normalizedStatus: options.status ?? MarketplaceOrderStatus.PAID,
      marketplaceAccount: {
        businessAccount: { code: options.account ?? 'C1' },
      },
    },
  };
}

function service(database: MlbAbcDatabase): MlbSalesAbcService {
  const config = {
    get: () => 'America/Sao_Paulo',
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new MlbSalesAbcService(
    database as unknown as DatabaseService,
    config,
  );
}

class MlbAbcDatabase {
  readonly calls: unknown[] = [];

  readonly marketplaceOrderItem = {
    findMany: async (args: unknown) => {
      this.calls.push(args);
      return this.items;
    },
  };

  readonly marketplaceOrder = {
    aggregate: async () => ({ _max: { updatedAt: this.lastUpdatedAt } }),
  };

  readonly marketplaceOrderBackfillRun = {
    aggregate: async () => ({ _max: { completedAt: this.lastSyncedAt } }),
  };

  readonly marketplaceListing = {
    findMany: async () =>
      this.listings.map((listing) => ({
        externalListingId: listing.externalListingId,
        title: listing.title,
        marketplaceAccount: {
          businessAccount: { code: listing.account },
        },
      })),
  };

  constructor(
    private readonly items: MlbSalesAbcSourceItem[],
    private readonly listings: Array<{
      externalListingId: string;
      title: string | null;
      account: string;
    }> = [],
    private readonly lastUpdatedAt: Date | null = null,
    private readonly lastSyncedAt: Date | null = null,
  ) {}
}

function soldAtFilter(call: unknown): unknown {
  return nestedRecord(call, ['where', 'marketplaceOrder', 'is', 'soldAt']);
}

function accountCodes(call: unknown): unknown {
  return nestedRecord(call, [
    'where',
    'marketplaceOrder',
    'is',
    'marketplaceAccount',
    'is',
    'businessAccount',
    'is',
    'code',
    'in',
  ]);
}

function nestedRecord(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    assert.ok(current !== null && typeof current === 'object');
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
