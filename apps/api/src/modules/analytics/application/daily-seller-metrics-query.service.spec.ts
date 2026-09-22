import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';

import { DatabaseService } from '../../../database/database.service.js';
import {
  DailySellerMetricsQueryDto,
  DailySellerMetricsRangeQueryDto,
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

  constructor(
    private readonly snapshots: Snapshot[],
    accountIds = [ACCOUNT_ID, OTHER_ACCOUNT_ID],
  ) {
    this.accounts = new Set(accountIds);
  }

  marketplaceAccount = {
    findMany: async () =>
      [...this.accounts].map((id, index) => ({
        id,
        name: index === 0 ? 'Conta 2' : 'Conta 3',
        marketplace: index === 0 ? 'MERCADO_LIVRE' : 'SHOPEE',
      })),
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
    findMany: async ({ where }: RangeQuery) => {
      this.rangeQueries.push({
        marketplaceAccountId: where.marketplaceAccountId,
        from: where.businessDate.gte,
        to: where.businessDate.lte,
      });
      return this.snapshots
        .filter(
          (item) =>
            item.marketplaceAccountId === where.marketplaceAccountId &&
            item.businessDate >= where.businessDate.gte &&
            item.businessDate <= where.businessDate.lte,
        )
        .sort((left, right) => left.businessDate.getTime() - right.businessDate.getTime());
    },
  };
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
