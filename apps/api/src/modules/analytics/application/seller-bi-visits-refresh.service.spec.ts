import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Prisma } from '@prisma/client';

import { SellerBiVisitsRefreshService } from './seller-bi-visits-refresh.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';

describe('SellerBiVisitsRefreshService', () => {
  it('audits C2 with an inclusive D-to-D request and reproduces the official conversion', async () => {
    const database = new VisitsDatabase([
      snapshot('2026-10-03', '39', '1401', '2.7837259101'),
      snapshot('2026-10-04', '10', '999', '1.001001001'),
    ]);
    const client = new VisitsClient(new Map([
      ['2026-10-03', 773],
      ['2026-10-04', 628],
    ]));
    const result = await service(database, client).refreshRange({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-10-03',
      to: '2026-10-04',
    });

    assert.deepEqual(client.calls, [
      ['seller-c2', '2026-10-03', '2026-10-03', { id: ACCOUNT_ID }],
      ['seller-c2', '2026-10-04', '2026-10-04', { id: ACCOUNT_ID }],
    ]);
    assert.equal(result.days[0]?.correctedVisits, 773);
    assert.equal(result.days[0]?.salesCount, '39');
    assert.equal(result.days[0]?.correctedConversionRate, '5.0452781371');
    assert.equal(result.days[1]?.correctedVisits, 628);
    assert.ok(result.days.every(({ action }) => action === 'WOULD_UPDATE'));
    assert.equal(database.transactionCount, 0);
  });

  it('updates only Visits and Conversion Rate, observes retroactive revisions, and is idempotent', async () => {
    const input = snapshot('2026-10-03', '39', '760', '5.1315789474');
    const database = new VisitsDatabase([input]);
    const client = new VisitsClient(new Map([['2026-10-03', 773]]));
    const refresh = service(database, client);

    const first = await refresh.refreshRange({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-10-03',
      to: '2026-10-03',
      apply: true,
    });
    const protectedMetric = input.metrics.find(({ name }) => name === 'SALES_COUNT')!;
    assert.equal(first.days[0]?.action, 'UPDATED');
    assert.equal(database.metric('2026-10-03', 'VISITS').value?.toString(), '773');
    assert.equal(
      database.metric('2026-10-03', 'CONVERSION_RATE').value?.toString(),
      '5.0452781371',
    );
    assert.equal(protectedMetric.value?.toString(), '39');
    assert.equal(database.transactionCount, 1);

    const repeated = await refresh.refreshRange({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-10-03',
      to: '2026-10-03',
      apply: true,
    });
    assert.equal(repeated.days[0]?.action, 'UNCHANGED');
    assert.equal(database.transactionCount, 1);
  });

  it('stores a null conversion when official visits are zero', async () => {
    const database = new VisitsDatabase([
      snapshot('2026-10-02', '3', null, null),
    ]);
    const result = await service(
      database,
      new VisitsClient(new Map([['2026-10-02', 0]])),
    ).refreshRange({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-10-02',
      to: '2026-10-02',
      apply: true,
    });

    assert.equal(result.days[0]?.correctedConversionRate, null);
    assert.equal(database.metric('2026-10-02', 'VISITS').value?.toString(), '0');
    const conversion = database.metric('2026-10-02', 'CONVERSION_RATE');
    assert.equal(conversion.value, null);
    assert.equal(conversion.status, 'UNAVAILABLE');
  });

  it('refreshes the seven latest closed calendar labels independently of GeFinance and does not timezone-shift them', async () => {
    const snapshots = [
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ].map((date) => snapshot(date, '1', '1', '100'));
    const database = new VisitsDatabase(snapshots);
    const client = new VisitsClient(new Map(
      snapshots.map(({ businessDate }) => [businessDate.toISOString().slice(0, 10), 1]),
    ));
    await service(database, client).refreshRecentClosed({
      marketplaceAccountId: ACCOUNT_ID,
      currentDate: '2026-10-04',
      limit: 7,
      excludeDates: ['2026-10-03'],
    });

    assert.deepEqual(
      client.calls.map(([, from, to]) => [from, to]),
      [
        ['2026-09-27', '2026-09-27'],
        ['2026-09-28', '2026-09-28'],
        ['2026-09-29', '2026-09-29'],
        ['2026-09-30', '2026-09-30'],
        ['2026-10-01', '2026-10-01'],
        ['2026-10-02', '2026-10-02'],
      ],
    );
  });
});

function service(database: VisitsDatabase, client: VisitsClient) {
  return new SellerBiVisitsRefreshService(database as never, client as never);
}

interface Metric {
  name: 'SALES_COUNT' | 'VISITS' | 'CONVERSION_RATE';
  value: Prisma.Decimal | null;
  source: string;
  status: string;
  confidence: string;
  validationEvidence: Prisma.InputJsonValue;
}

interface Snapshot {
  id: string;
  businessDate: Date;
  metrics: Metric[];
}

function snapshot(
  date: string,
  sales: string,
  visits: string | null,
  conversion: string | null,
): Snapshot {
  return {
    id: `snapshot-${date}`,
    businessDate: new Date(`${date}T00:00:00.000Z`),
    metrics: [
      metric('SALES_COUNT', sales, 'MERCADO_LIVRE'),
      metric('VISITS', visits, 'MERCADO_LIVRE'),
      metric('CONVERSION_RATE', conversion, 'DERIVED'),
    ],
  };
}

function metric(
  name: Metric['name'],
  value: string | null,
  source: string,
): Metric {
  return {
    name,
    value: value === null ? null : new Prisma.Decimal(value),
    source,
    status: value === null ? 'UNAVAILABLE' : 'AVAILABLE',
    confidence: value === null ? 'LOW' : 'HIGH',
    validationEvidence:
      name === 'SALES_COUNT'
        ? [{ metric: 'salesCount', source: 'MERCADO_LIVRE', value }]
        : [],
  };
}

class VisitsClient {
  readonly calls: unknown[][] = [];

  constructor(private readonly visits: Map<string, number>) {}

  async getUserVisits(
    seller: string,
    dateFrom: string,
    dateTo: string,
    account: { id: string },
  ) {
    this.calls.push([seller, dateFrom, dateTo, account]);
    return {
      user_id: seller,
      date_from: `${dateFrom}T00:00:00.000-04:00`,
      date_to: `${dateTo}T23:59:59.999-04:00`,
      total_visits: this.visits.get(dateFrom) ?? 0,
    };
  }
}

class VisitsDatabase {
  transactionCount = 0;

  constructor(private readonly snapshots: Snapshot[]) {}

  readonly marketplaceAccount = {
    findUnique: async () => ({
      id: ACCOUNT_ID,
      name: 'Conta 2',
      externalAccountId: 'seller-c2',
    }),
  };

  readonly dailySellerMetrics = {
    findMany: async (args: {
      where: { businessDate: { lt?: Date; gte?: Date; lte?: Date; in?: Date[] } };
      orderBy: { businessDate: 'asc' | 'desc' };
      take?: number;
      select: { metrics?: unknown };
    }) => {
      let found = this.snapshots.filter(({ businessDate }) => {
        const range = args.where.businessDate;
        if (range.lt && businessDate >= range.lt) return false;
        if (range.gte && businessDate < range.gte) return false;
        if (range.lte && businessDate > range.lte) return false;
        if (range.in && !range.in.some((date) => date.getTime() === businessDate.getTime())) return false;
        return true;
      });
      found = found.sort((left, right) =>
        args.orderBy.businessDate === 'asc'
          ? left.businessDate.getTime() - right.businessDate.getTime()
          : right.businessDate.getTime() - left.businessDate.getTime(),
      );
      if (args.take) found = found.slice(0, args.take);
      return found.map((entry) =>
        args.select.metrics ? entry : { businessDate: entry.businessDate },
      );
    },
  };

  async $transaction<T>(callback: (transaction: object) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return callback({
      dailySellerMetric: {
        update: async (args: {
          where: { dailySellerMetricsId_name: { dailySellerMetricsId: string; name: Metric['name'] } };
          data: Partial<Metric>;
        }) => {
          const identity = args.where.dailySellerMetricsId_name;
          const target = this.snapshots
            .find(({ id }) => id === identity.dailySellerMetricsId)
            ?.metrics.find(({ name }) => name === identity.name);
          assert.ok(target);
          Object.assign(target, args.data);
        },
      },
    });
  }

  metric(date: string, name: Metric['name']): Metric {
    const value = this.snapshots
      .find(({ businessDate }) => businessDate.toISOString().startsWith(date))
      ?.metrics.find((metric) => metric.name === name);
    assert.ok(value);
    return value;
  }
}
