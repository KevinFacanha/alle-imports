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
  MlbSalesAbcService,
  MlbSalesAbcSourceItem,
} from './mlb-sales-abc.service.js';

describe('MlbSalesAbcService', () => {
  it('uses inclusive start, exclusive end and Sao Paulo civil boundaries', async () => {
    const database = new MlbAbcDatabase([]);
    const result = await service(database).find(request());

    assert.equal(result.timezone, 'America/Sao_Paulo');
    assert.equal(result.periodStart, '2026-09-01');
    assert.equal(result.periodEnd, '2026-10-01');
    assert.deepEqual(soldAtFilter(database.calls[0]), {
      gte: new Date('2026-09-01T03:00:00.000Z'),
      lt: new Date('2026-10-01T03:00:00.000Z'),
    });
    assert.equal(JSON.stringify(database.calls[0]).includes('lte'), false);
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
    ...request(),
    timezone: 'America/Sao_Paulo',
    items,
    ...overrides,
  });
}

function item(
  externalListingId: string,
  externalSellableId: string,
  orderId: string,
  quantity: number,
  unitPrice: string,
  grossAmount = new Prisma.Decimal(unitPrice).mul(quantity).toString(),
  options: { account?: string; status?: MarketplaceOrderStatus } = {},
): MlbSalesAbcSourceItem & { externalSellableId: string } {
  return {
    externalListingId,
    externalSellableId,
    quantity,
    unitPrice: new Prisma.Decimal(unitPrice),
    grossAmount: new Prisma.Decimal(grossAmount),
    marketplaceOrder: {
      id: orderId,
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

  constructor(private readonly items: MlbSalesAbcSourceItem[]) {}
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
