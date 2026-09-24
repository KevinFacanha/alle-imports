import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';

import { DatabaseService } from '../../../database/database.service.js';
import {
  DailySellerMetricsQueryDto,
  DailySellerMetricsRangeQueryDto,
  SellerMetricsComparisonQueryDto,
} from '../http/seller-metrics-query.dto.js';
import {
  DailySellerMetricsQueryService,
  MAX_SELLER_METRICS_RANGE_DAYS,
} from './daily-seller-metrics-query.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';

describe('DailySellerMetricsQueryService', () => {
  it('returns only active accounts without credentials or external identifiers', async () => {
    const database = new QueryDatabase([]);

    const result = await service(database).findActiveAccounts();

    assert.deepEqual(result, [
      {
        id: ACCOUNT_ID,
        name: 'Conta 2',
        marketplace: 'MERCADO_LIVRE',
      },
      {
        id: OTHER_ACCOUNT_ID,
        name: 'Conta 3',
        marketplace: 'SHOPEE',
      },
    ]);
    assert.equal(JSON.stringify(result).includes('externalAccountId'), false);
    assert.equal(JSON.stringify(result).includes('token'), false);
  });

  it('rejects invalid UUIDs and invalid date-only query values', async () => {
    const daily = Object.assign(new DailySellerMetricsQueryDto(), {
      marketplaceAccountId: 'not-an-uuid',
      date: '2026-02-31',
    });
    const range = Object.assign(new DailySellerMetricsRangeQueryDto(), {
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-09-16T00:00:00Z',
      to: '16-09-2026',
    });

    const dailyErrors = await validate(daily);
    const rangeErrors = await validate(range);

    assert.deepEqual(
      dailyErrors.map(({ property }) => property).sort(),
      ['date', 'marketplaceAccountId'],
    );
    assert.deepEqual(
      rangeErrors.map(({ property }) => property).sort(),
      ['from', 'to'],
    );
  });

  it('returns an existing persisted snapshot with null and lossless Decimal values', async () => {
    const database = new QueryDatabase([snapshot('2026-09-16', ACCOUNT_ID)]);

    const result = await service(database).findDaily(ACCOUNT_ID, '2026-09-16');

    assert.equal(result.marketplaceAccountId, ACCOUNT_ID);
    assert.equal(result.businessDate, '2026-09-16');
    assert.equal(result.timezone, 'America/Sao_Paulo');
    assert.equal(result.calculatedAt, '2026-09-16T20:00:00.000Z');
    assert.equal(result.metrics.grossSales.value, '12345678901234567890.123456789');
    assert.equal(result.metrics.visits.value, null);
    assert.equal(result.metrics.visits.status, 'UNAVAILABLE');
  });

  it('returns 404 when the account does not exist', async () => {
    const database = new QueryDatabase([], [ACCOUNT_ID]);

    await assert.rejects(
      service(database).findDaily(OTHER_ACCOUNT_ID, '2026-09-16'),
      NotFoundException,
    );
    assert.equal(database.dailyQueries.length, 0);
  });

  it('returns 404 when the account exists but its snapshot does not', async () => {
    const database = new QueryDatabase([], [ACCOUNT_ID]);

    await assert.rejects(
      service(database).findDaily(ACCOUNT_ID, '2026-09-16'),
      NotFoundException,
    );
  });

  it('isolates snapshots by marketplace account in the database query', async () => {
    const own = snapshot('2026-09-16', ACCOUNT_ID);
    const other = snapshot('2026-09-16', OTHER_ACCOUNT_ID);
    other.metrics[0]!.value = new Prisma.Decimal(999);
    const database = new QueryDatabase([own, other]);

    const result = await service(database).findDaily(ACCOUNT_ID, '2026-09-16');

    assert.equal(result.metrics.salesCount.value, '2');
    assert.deepEqual(database.dailyQueries[0], {
      marketplaceAccountId: ACCOUNT_ID,
      businessDate: new Date('2026-09-16T00:00:00.000Z'),
    });
  });

  it('returns a range in ascending date order using an account-scoped query', async () => {
    const database = new QueryDatabase([
      snapshot('2026-09-18', ACCOUNT_ID),
      snapshot('2026-09-16', ACCOUNT_ID),
      snapshot('2026-09-17', ACCOUNT_ID),
      snapshot('2026-09-17', OTHER_ACCOUNT_ID),
    ]);

    const result = await service(database).findRange(
      ACCOUNT_ID,
      '2026-09-16',
      '2026-09-18',
    );

    assert.deepEqual(
      result.days.map(({ businessDate }) => businessDate),
      ['2026-09-16', '2026-09-17', '2026-09-18'],
    );
    assert.equal(result.days.every((day) => day.marketplaceAccountId === ACCOUNT_ID), true);
    assert.equal(database.rangeQueries[0]?.marketplaceAccountId, ACCOUNT_ID);
  });

  it('returns 404 when a range has no persisted snapshots', async () => {
    await assert.rejects(
      service(new QueryDatabase([])).findRange(
        ACCOUNT_ID,
        '2026-09-16',
        '2026-09-18',
      ),
      NotFoundException,
    );
  });

  it('rejects reversed and oversized ranges', async () => {
    const queryService = service(new QueryDatabase([]));

    await assert.rejects(
      queryService.findRange(ACCOUNT_ID, '2026-09-17', '2026-09-16'),
      BadRequestException,
    );
    await assert.rejects(
      queryService.findRange(ACCOUNT_ID, '2026-01-01', '2026-02-01'),
      new RegExp(`${MAX_SELLER_METRICS_RANGE_DAYS} days`),
    );
  });

  it('compares two accounts with aligned dates, null missing days and exact summaries', async () => {
    const database = new QueryDatabase([
      comparisonSnapshot('2026-09-16', ACCOUNT_ID, {
        grossSales: '100',
        fullGrossSales: '40',
        salesCount: '2',
        fullSalesCount: '1',
        marginRate: '10',
        marginAmount: '10',
        marginBaseAmount: '100',
      }),
      comparisonSnapshot('2026-09-17', ACCOUNT_ID, {
        grossSales: '300',
        fullGrossSales: '60',
        salesCount: '3',
        fullSalesCount: '2',
        marginRate: '50',
        marginAmount: '150',
        marginBaseAmount: '300',
      }),
      comparisonSnapshot('2026-09-16', OTHER_ACCOUNT_ID, {
        grossSales: '200',
        fullGrossSales: '100',
        salesCount: '4',
        fullSalesCount: '2',
        marginRate: '10',
        marginAmount: '20',
        marginBaseAmount: '200',
      }),
      comparisonSnapshot('2026-09-18', OTHER_ACCOUNT_ID, {
        grossSales: '100',
        fullGrossSales: '25',
        salesCount: '1',
        fullSalesCount: '1',
        marginRate: '50',
        marginAmount: '50',
        marginBaseAmount: '100',
      }),
    ]);

    const result = await service(database).findComparison(
      ACCOUNT_ID,
      OTHER_ACCOUNT_ID,
      '2026-09-16',
      '2026-09-18',
    );

    assert.deepEqual(result.accounts.map(({ marketplaceAccountId }) => marketplaceAccountId), [
      ACCOUNT_ID,
      OTHER_ACCOUNT_ID,
    ]);
    assert.deepEqual(result.accounts[0]!.summary, {
      grossSales: '400',
      fullGrossSales: '100',
      salesCount: '5',
      fullSalesCount: '3',
      averageTicket: '80',
      marginRate: '40',
      marginRateStatus: 'AVAILABLE',
    });
    assert.notEqual(result.accounts[0]!.summary.marginRate, '30');
    assert.deepEqual(result.accounts[1]!.summary, {
      grossSales: '300',
      fullGrossSales: '125',
      salesCount: '5',
      fullSalesCount: '3',
      averageTicket: '60',
      marginRate: '23.3333333333',
      marginRateStatus: 'AVAILABLE',
    });
    assert.deepEqual(
      result.accounts.map(({ days }) => days.map(({ date }) => date)),
      [
        ['2026-09-16', '2026-09-17', '2026-09-18'],
        ['2026-09-16', '2026-09-17', '2026-09-18'],
      ],
    );
    assert.deepEqual(result.accounts[0]!.days[2], {
      date: '2026-09-18',
      grossSales: null,
      marginRate: null,
      fullGrossSales: null,
      averageTicket: null,
      salesCount: null,
      fullSalesCount: null,
      snapshotAvailable: false,
      status: 'MISSING_SNAPSHOT',
    });
    assert.deepEqual(
      result.accounts.map(({ availableDays, missingDays, expectedDays }) => ({
        availableDays,
        missingDays,
        expectedDays,
      })),
      [
        { availableDays: 2, missingDays: 1, expectedDays: 3 },
        { availableDays: 2, missingDays: 1, expectedDays: 3 },
      ],
    );
    assert.deepEqual(database.comparisonQueries[0]?.accountIds, [
      ACCOUNT_ID,
      OTHER_ACCOUNT_ID,
    ]);
  });

  it('never approximates a period margin from legacy daily rates', async () => {
    const result = await service(
      new QueryDatabase([snapshot('2026-09-16', ACCOUNT_ID)]),
    ).findComparison(
      ACCOUNT_ID,
      OTHER_ACCOUNT_ID,
      '2026-09-16',
      '2026-09-16',
    );

    assert.equal(result.accounts[0]!.summary.marginRate, null);
    assert.equal(
      result.accounts[0]!.summary.marginRateStatus,
      'UNAVAILABLE_COMPONENTS',
    );
  });

  it('rejects the same account, invalid periods and invalid comparison UUIDs', async () => {
    const queryService = service(new QueryDatabase([]));
    await assert.rejects(
      queryService.findComparison(
        ACCOUNT_ID,
        ACCOUNT_ID,
        '2026-09-16',
        '2026-09-17',
      ),
      BadRequestException,
    );
    await assert.rejects(
      queryService.findComparison(
        ACCOUNT_ID,
        OTHER_ACCOUNT_ID,
        '2026-09-18',
        '2026-09-17',
      ),
      BadRequestException,
    );

    const dto = Object.assign(new SellerMetricsComparisonQueryDto(), {
      accountAId: 'invalid',
      accountBId: 'also-invalid',
      from: '2026-09-01',
      to: '2026-09-32',
    });
    assert.deepEqual(
      (await validate(dto)).map(({ property }) => property).sort(),
      ['accountAId', 'accountBId', 'to'],
    );
  });

  it('returns only snapshots scoped to the requested comparison accounts', async () => {
    const outsideId = '00000000-0000-4000-8000-000000000004';
    const own = comparisonSnapshot('2026-09-16', ACCOUNT_ID, {
      grossSales: '10', fullGrossSales: '1', salesCount: '1', fullSalesCount: '1',
      marginRate: '10', marginAmount: '1', marginBaseAmount: '10',
    });
    const outside = comparisonSnapshot('2026-09-16', outsideId, {
      grossSales: '999', fullGrossSales: '999', salesCount: '999', fullSalesCount: '999',
      marginRate: '99', marginAmount: '999', marginBaseAmount: '1',
    });
    const database = new QueryDatabase([own, outside]);

    const result = await service(database).findComparison(
      ACCOUNT_ID,
      OTHER_ACCOUNT_ID,
      '2026-09-16',
      '2026-09-16',
    );

    assert.equal(result.accounts[0]!.summary.grossSales, '10');
    assert.equal(JSON.stringify(result).includes('999'), false);
  });

  it('allowlists evidence and does not expose PII or free text', async () => {
    const stored = snapshot('2026-09-16', ACCOUNT_ID);
    stored.metrics[2]!.validationEvidence = [
      {
        metric: 'grossSales',
        source: 'OLIST',
        value: '100.20',
        status: 'AVAILABLE',
        comparison: 'DIVERGENT',
        absoluteDifference: '23.25',
        percentageDifference: '18.8371',
        notes: 'buyer@example.com CPF 123.456.789-09',
        semantic: 'Customer Secret Person',
        buyerName: 'Secret Person',
        filePath: 'C:\\private\\report.xlsx',
      },
    ];

    const result = await service(new QueryDatabase([stored])).findDaily(
      ACCOUNT_ID,
      '2026-09-16',
    );
    const encoded = JSON.stringify(result.metrics.grossSales.validationEvidence);

    assert.deepEqual(result.metrics.grossSales.validationEvidence, [
      {
        metric: 'grossSales',
        source: 'OLIST',
        value: '100.2',
        status: 'AVAILABLE',
        comparison: 'DIVERGENT',
        absoluteDifference: '23.25',
        percentageDifference: '18.8371',
      },
    ]);
    assert.equal(encoded.includes('buyer@example.com'), false);
    assert.equal(encoded.includes('Secret Person'), false);
    assert.equal(encoded.includes('report.xlsx'), false);
  });
});

function service(database: QueryDatabase): DailySellerMetricsQueryService {
  return new DailySellerMetricsQueryService(database as unknown as DatabaseService);
}

type Snapshot = {
  marketplaceAccountId: string;
  businessDate: Date;
  timezone: string;
  calculatedAt: Date;
  metrics: Array<{
    name: MetricName;
    value: Prisma.Decimal | null;
    source: 'MERCADO_LIVRE' | 'OLIST' | 'GEFINANCE' | 'DERIVED';
    status: 'AVAILABLE' | 'UNAVAILABLE' | 'INCOMPATIBLE_SEMANTICS' | 'PROVISIONAL';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    validationEvidence: Prisma.JsonValue;
  }>;
};

type MetricName =
  | 'SALES_COUNT'
  | 'UNITS_SOLD'
  | 'GROSS_SALES'
  | 'MARGIN_RATE'
  | 'FULL_SALES_COUNT'
  | 'FULL_UNITS_SOLD'
  | 'FULL_GROSS_SALES'
  | 'VISITS'
  | 'AVERAGE_TICKET'
  | 'CONVERSION_RATE';

interface ComparisonValues {
  grossSales: string;
  fullGrossSales: string;
  salesCount: string;
  fullSalesCount: string;
  marginRate: string;
  marginAmount: string;
  marginBaseAmount: string;
}

function comparisonSnapshot(
  date: string,
  marketplaceAccountId: string,
  values: ComparisonValues,
): Snapshot {
  const result = snapshot(date, marketplaceAccountId);
  setMetric(result, 'GROSS_SALES', values.grossSales);
  setMetric(result, 'FULL_GROSS_SALES', values.fullGrossSales);
  setMetric(result, 'SALES_COUNT', values.salesCount);
  setMetric(result, 'FULL_SALES_COUNT', values.fullSalesCount);
  setMetric(result, 'MARGIN_RATE', values.marginRate);
  setMetric(
    result,
    'AVERAGE_TICKET',
    new Prisma.Decimal(values.grossSales)
      .dividedBy(values.salesCount)
      .toString(),
  );
  const margin = result.metrics.find(({ name }) => name === 'MARGIN_RATE')!;
  margin.source = 'GEFINANCE';
  margin.validationEvidence = [
    {
      metric: 'marginRate',
      source: 'GEFINANCE',
      value: values.marginAmount,
      component: 'MARGIN_AMOUNT',
      status: 'AVAILABLE',
    },
    {
      metric: 'marginRate',
      source: 'GEFINANCE',
      value: values.marginBaseAmount,
      component: 'MARGIN_BASE_AMOUNT',
      status: 'AVAILABLE',
    },
  ];
  return result;
}

function setMetric(
  value: Snapshot,
  name: MetricName,
  amount: string,
): void {
  value.metrics.find((metric) => metric.name === name)!.value =
    new Prisma.Decimal(amount);
}

function snapshot(date: string, marketplaceAccountId: string): Snapshot {
  const values: Array<[MetricName, string | null]> = [
    ['SALES_COUNT', '2'],
    ['UNITS_SOLD', '4'],
    ['GROSS_SALES', '12345678901234567890.1234567890'],
    ['MARGIN_RATE', '15.9668874172'],
    ['FULL_SALES_COUNT', '1'],
    ['FULL_UNITS_SOLD', '3'],
    ['FULL_GROSS_SALES', '48.90'],
    ['VISITS', null],
    ['AVERAGE_TICKET', '50.125'],
    ['CONVERSION_RATE', '0.002'],
  ];
  return {
    marketplaceAccountId,
    businessDate: new Date(`${date}T00:00:00.000Z`),
    timezone: 'America/Sao_Paulo',
    calculatedAt: new Date(`${date}T20:00:00.000Z`),
    metrics: values.map(([name, value]) => ({
      name,
      value: value === null ? null : new Prisma.Decimal(value),
      source: 'MERCADO_LIVRE',
      status: value === null ? 'UNAVAILABLE' : 'AVAILABLE',
      confidence: value === null ? 'LOW' : 'HIGH',
      validationEvidence: [],
    })),
  };
}

class QueryDatabase {
  readonly accounts: Set<string>;
  readonly dailyQueries: Array<{ marketplaceAccountId: string; businessDate: Date }> = [];
  readonly rangeQueries: Array<{ marketplaceAccountId: string; from: Date; to: Date }> = [];
  readonly comparisonQueries: Array<{ accountIds: string[]; from: Date; to: Date }> = [];

  constructor(
    private readonly snapshots: Snapshot[],
    accountIds = [ACCOUNT_ID, OTHER_ACCOUNT_ID],
  ) {
    this.accounts = new Set(accountIds);
  }

  marketplaceAccount = {
    findMany: async (query?: AccountListQuery) => {
      const requested = query?.where?.id?.in;
      return [...this.accounts]
        .filter((id) => requested === undefined || requested.includes(id))
        .map((id, index) => ({
          id,
          name: id === ACCOUNT_ID ? 'Conta 2' : 'Conta 3',
          marketplace: index === 0 ? 'MERCADO_LIVRE' : 'SHOPEE',
        }));
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.accounts.has(where.id) ? { id: where.id } : null,
  };

  dailySellerMetrics = {
    findUnique: async ({ where }: DailyQuery) => {
      const identity = where.marketplaceAccountId_businessDate;
      this.dailyQueries.push(identity);
      return (
        this.snapshots.find(
          (item) =>
            item.marketplaceAccountId === identity.marketplaceAccountId &&
            item.businessDate.getTime() === identity.businessDate.getTime(),
        ) ?? null
      );
    },
    findMany: async ({ where }: RangeQuery | ComparisonQuery) => {
      const accountFilter = where.marketplaceAccountId;
      const accountIds =
        typeof accountFilter === 'string' ? [accountFilter] : accountFilter.in;
      if (typeof accountFilter === 'string') {
        this.rangeQueries.push({
          marketplaceAccountId: accountFilter,
          from: where.businessDate.gte,
          to: where.businessDate.lte,
        });
      } else {
        this.comparisonQueries.push({
          accountIds: [...accountIds],
          from: where.businessDate.gte,
          to: where.businessDate.lte,
        });
      }
      return this.snapshots
        .filter(
          (item) =>
            accountIds.includes(item.marketplaceAccountId) &&
            item.businessDate >= where.businessDate.gte &&
            item.businessDate <= where.businessDate.lte,
        )
        .sort((left, right) => left.businessDate.getTime() - right.businessDate.getTime());
    },
  };
}

interface AccountListQuery {
  where?: { id?: { in: string[] } };
}

interface DailyQuery {
  where: {
    marketplaceAccountId_businessDate: {
      marketplaceAccountId: string;
      businessDate: Date;
    };
  };
}

interface RangeQuery {
  where: {
    marketplaceAccountId: string;
    businessDate: { gte: Date; lte: Date };
  };
}

interface ComparisonQuery {
  where: {
    marketplaceAccountId: { in: string[] };
    businessDate: { gte: Date; lte: Date };
  };
}
