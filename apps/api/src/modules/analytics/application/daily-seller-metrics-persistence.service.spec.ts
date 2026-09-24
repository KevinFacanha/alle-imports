import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Prisma } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  ResolvedSellerBiMetric,
  ResolvedSellerBiMetrics,
} from './seller-bi-metric.types.js';
import { DailySellerMetricsPersistenceService } from './daily-seller-metrics-persistence.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const REPORT_HASH = 'a'.repeat(64);
const DAILY_HASH = 'd'.repeat(64);

describe('DailySellerMetricsPersistenceService', () => {
  it('creates one daily snapshot with ten Decimal metric values', async () => {
    const database = new InMemoryDatabase();
    const result = await service(database).persist(resolved(), metadata());

    assert.equal(result.action, 'CREATED');
    assert.equal(result.metricCount, 10);
    assert.equal(database.snapshots.size, 1);
    assert.equal(database.metrics.size, 10);
    assert.equal(database.transactionCount, 1);
    assert.deepEqual(database.transactionOptions, {
      maxWait: 10_000,
      timeout: 30_000,
    });
    assert.equal(database.snapshot(ACCOUNT_ID).geFinanceReportSha256, REPORT_HASH);
    assert.equal(database.snapshot(ACCOUNT_ID).geFinanceDailySha256, DAILY_HASH);
    const grossSales = database.metric(ACCOUNT_ID, 'GROSS_SALES');
    assert.ok(grossSales.value instanceof Prisma.Decimal);
    assert.equal(grossSales.value.toString(), '100.25');
    assert.equal(grossSales.source, 'MERCADO_LIVRE');
    assert.equal(grossSales.status, 'PROVISIONAL');
    assert.equal(grossSales.confidence, 'MEDIUM');
    const marginEvidence = database.metric(ACCOUNT_ID, 'MARGIN_RATE')
      .validationEvidence as unknown as Array<Record<string, unknown>>;
    assert.deepEqual(
      marginEvidence
        .filter(({ component }) => component !== undefined)
        .map(({ component, value }) => ({ component, value })),
      [
        { component: 'MARGIN_AMOUNT', value: '24' },
        { component: 'MARGIN_BASE_AMOUNT', value: '150.31' },
      ],
    );
  });

  it('reprocesses the same account and date without duplicates and updates values', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    await persistence.persist(resolved(), metadata());
    const updated = resolved();
    updated.metrics.salesCount.value = 7;
    updated.metrics.grossSales.value = '987.65';

    const result = await persistence.persist(updated, {
      ...metadata(),
      calculatedAt: new Date('2026-09-17T09:00:00.000Z'),
    });

    assert.equal(result.action, 'UPDATED');
    assert.equal(database.snapshots.size, 1);
    assert.equal(database.metrics.size, 10);
    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'SALES_COUNT')).toString(), '7');
    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'GROSS_SALES')).toString(), '987.65');
    assert.equal(
      database.snapshot(ACCOUNT_ID).calculatedAt.toISOString(),
      '2026-09-17T09:00:00.000Z',
    );
  });

  it('stores a real null for unavailable metrics', async () => {
    const database = new InMemoryDatabase();
    const input = resolved();
    input.metrics.visits = metric(999, {
      source: 'MERCADO_LIVRE',
      status: 'UNAVAILABLE',
      confidence: 'LOW',
    });
    input.metrics.conversionRate = metric(null, {
      source: 'DERIVED',
      status: 'UNAVAILABLE',
      confidence: 'LOW',
    });

    const result = await service(database).persist(input, metadata());

    assert.equal(database.metric(ACCOUNT_ID, 'VISITS').value, null);
    assert.equal(database.metric(ACCOUNT_ID, 'CONVERSION_RATE').value, null);
    assert.deepEqual(result.unavailableMetrics, ['visits', 'conversionRate']);
  });

  it('isolates equal business dates between marketplace accounts', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    await persistence.persist(resolved(), metadata());
    const second = resolved();
    second.metrics.salesCount.value = 22;
    await persistence.persist(second, metadata(SECOND_ACCOUNT_ID));

    assert.equal(database.snapshots.size, 2);
    assert.equal(database.metrics.size, 20);
    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'SALES_COUNT')).toString(), '2');
    assert.equal(decimalValue(database.metric(SECOND_ACCOUNT_ID, 'SALES_COUNT')).toString(), '22');
    const firstAccountSnapshots = await persistence.findExistingSnapshots({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-09-16',
      to: '2026-09-16',
    });
    const secondAccountSnapshots = await persistence.findExistingSnapshots({
      marketplaceAccountId: SECOND_ACCOUNT_ID,
      from: '2026-09-16',
      to: '2026-09-16',
    });
    assert.equal(firstAccountSnapshots.size, 1);
    assert.equal(secondAccountSnapshots.size, 1);
    assert.equal(
      firstAccountSnapshots.get('2026-09-16')?.geFinanceDailySha256,
      DAILY_HASH,
    );
  });

  it('backfills legacy daily hashes locally without changing metrics, calculatedAt or another account', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    await persistence.persist(resolved(), metadata());
    await persistence.persist(resolved(), metadata(SECOND_ACCOUNT_ID));
    const firstSnapshot = database.snapshot(ACCOUNT_ID);
    const secondSnapshot = database.snapshot(SECOND_ACCOUNT_ID);
    firstSnapshot.geFinanceDailySha256 = null;
    secondSnapshot.geFinanceDailySha256 = null;
    const calculatedAt = firstSnapshot.calculatedAt.toISOString();
    const metricsBefore = JSON.stringify([...database.metrics.values()]);

    const result = await persistence.backfillGeFinanceDailyHashes({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-09-16',
      to: '2026-09-16',
      days: [{ businessDate: '2026-09-16', sha256: DAILY_HASH }],
    });

    assert.deepEqual(result, {
      daysFound: 1,
      snapshotsFound: 1,
      hashesFilled: 1,
      alreadyHashed: 0,
      snapshotsMissing: 0,
    });
    assert.equal(database.findManyCount, 1);
    assert.equal(database.executeRawCount, 1);
    assert.equal(firstSnapshot.geFinanceDailySha256, DAILY_HASH);
    assert.equal(secondSnapshot.geFinanceDailySha256, null);
    assert.equal(firstSnapshot.calculatedAt.toISOString(), calculatedAt);
    assert.equal(JSON.stringify([...database.metrics.values()]), metricsBefore);
    assert.equal(database.lastRawSql?.includes('calculated_at'), false);
    assert.equal(database.lastRawSql?.includes('updated_at'), false);
    assert.equal(database.lastRawSql?.includes('daily_seller_metric_values'), false);

    const repeated = await persistence.backfillGeFinanceDailyHashes({
      marketplaceAccountId: ACCOUNT_ID,
      from: '2026-09-16',
      to: '2026-09-16',
      days: [{ businessDate: '2026-09-16', sha256: 'e'.repeat(64) }],
    });
    assert.equal(repeated.hashesFilled, 0);
    assert.equal(repeated.alreadyHashed, 1);
    assert.equal(firstSnapshot.geFinanceDailySha256, DAILY_HASH);
    assert.equal(database.executeRawCount, 1);
  });

  it('backfills only margin components and is idempotent per account and date', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    await persistence.persist(resolved(), metadata());
    await persistence.persist(resolved(), metadata(SECOND_ACCOUNT_ID));
    const margin = database.metric(ACCOUNT_ID, 'MARGIN_RATE');
    margin.validationEvidence = (margin.validationEvidence as Prisma.InputJsonArray)
      .filter((entry) =>
        typeof entry !== 'object' || entry === null || Array.isArray(entry) ||
        !('component' in entry),
      );
    const protectedBefore = new Map(
      [...database.metrics.entries()]
        .filter(([key]) => !key.endsWith('|MARGIN_RATE'))
        .map(([key, value]) => [key, JSON.stringify(value)]),
    );
    const calculatedAtBefore = database.snapshot(ACCOUNT_ID).calculatedAt.toISOString();

    const first = await persistence.backfillGeFinanceMarginComponents({
      marketplaceAccountId: ACCOUNT_ID,
      businessDate: '2026-09-16',
      marginAmount: new Prisma.Decimal('12.5'),
      marginBaseAmount: new Prisma.Decimal('50'),
    });
    const evidence = database.metric(ACCOUNT_ID, 'MARGIN_RATE')
      .validationEvidence as Prisma.InputJsonArray;
    assert.equal(first, 'ENRICHED');
    assert.deepEqual(
      evidence.flatMap((entry) =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
        'component' in entry
          ? [{ component: entry.component, value: entry.value }]
          : [],
      ),
      [
        { component: 'MARGIN_AMOUNT', value: '12.5' },
        { component: 'MARGIN_BASE_AMOUNT', value: '50' },
      ],
    );
    for (const [key, before] of protectedBefore) {
      assert.equal(JSON.stringify(database.metrics.get(key)), before);
    }
    assert.equal(
      database.snapshot(ACCOUNT_ID).calculatedAt.toISOString(),
      calculatedAtBefore,
    );

    const repeated = await persistence.backfillGeFinanceMarginComponents({
      marketplaceAccountId: ACCOUNT_ID,
      businessDate: '2026-09-16',
      marginAmount: new Prisma.Decimal('12.5'),
      marginBaseAmount: new Prisma.Decimal('50'),
    });
    assert.equal(repeated, 'UNCHANGED');
    assert.equal(
      (database.metric(ACCOUNT_ID, 'MARGIN_RATE').validationEvidence as Prisma.InputJsonArray)
        .filter((entry) =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
          'component' in entry,
        ).length,
      2,
    );
  });

  it('refreshes only GeFinance-owned values/evidence and preserves ML, Olist and derived values', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    const input = resolved();
    input.metrics.fullGrossSales.validationEvidence = [
      {
        metric: 'fullGrossSales',
        source: 'OLIST',
        value: '48.90',
        status: 'PROVISIONAL',
        comparison: 'PRIMARY',
        semantic: 'SUM(Olist totalProdutos), channel Mercado Livre Fulfillment',
        absoluteDifference: null,
        percentageDifference: null,
        notes: 'Primary Olist evidence.',
      },
      {
        metric: 'fullGrossSales',
        source: 'GEFINANCE',
        value: '40.00',
        status: 'AVAILABLE',
        comparison: 'DIVERGENT',
        semantic: 'old',
        absoluteDifference: '8.9',
        percentageDifference: '18.2004',
        notes: 'Old GeFinance evidence.',
      },
    ];
    await persistence.persist(input, metadata());
    const preserved = new Map(
      ['SALES_COUNT', 'UNITS_SOLD', 'GROSS_SALES', 'FULL_SALES_COUNT',
       'FULL_UNITS_SOLD', 'VISITS', 'AVERAGE_TICKET', 'CONVERSION_RATE']
        .map((name) => [name, JSON.stringify(database.metric(ACCOUNT_ID, name))]),
    );
    const fullGrossBefore = database.metric(ACCOUNT_ID, 'FULL_GROSS_SALES');

    const result = await persistence.refreshGeFinanceMetrics({
      marketplaceAccountId: ACCOUNT_ID,
      businessDate: '2026-09-16',
      geFinanceReportSha256: 'e'.repeat(64),
      geFinanceDailySha256: 'f'.repeat(64),
      marginRate: new Prisma.Decimal('0.25'),
      marginAmount: new Prisma.Decimal('12.5'),
      marginBaseAmount: new Prisma.Decimal('50'),
      fullGrossSalesEvidenceAmount: new Prisma.Decimal('50.25'),
      calculatedAt: new Date('2026-09-17T10:00:00.000Z'),
    });

    assert.equal(result.action, 'UPDATED');
    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'MARGIN_RATE')).toString(), '25');
    assert.equal(database.metric(ACCOUNT_ID, 'MARGIN_RATE').source, 'GEFINANCE');
    for (const [name, before] of preserved) {
      assert.equal(JSON.stringify(database.metric(ACCOUNT_ID, name)), before);
    }
    const fullGrossAfter = database.metric(ACCOUNT_ID, 'FULL_GROSS_SALES');
    assert.equal(fullGrossAfter.value?.toString(), fullGrossBefore.value?.toString());
    assert.equal(fullGrossAfter.source, 'OLIST');
    assert.equal(fullGrossAfter.status, 'PROVISIONAL');
    assert.equal(fullGrossAfter.confidence, 'MEDIUM');
    const evidence = fullGrossAfter.validationEvidence as unknown as Array<Record<string, unknown>>;
    assert.equal(evidence.filter(({ source }) => source === 'GEFINANCE').length, 1);
    assert.equal(evidence.find(({ source }) => source === 'GEFINANCE')?.value, '50.25');
    assert.equal(evidence.find(({ source }) => source === 'OLIST')?.notes, 'Primary Olist evidence.');
    assert.equal(database.snapshot(ACCOUNT_ID).geFinanceDailySha256, 'f'.repeat(64));
  });

  it('rolls back the complete local GeFinance refresh when one metric update fails', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    await persistence.persist(resolved(), metadata());
    const marginBefore = JSON.stringify(database.metric(ACCOUNT_ID, 'MARGIN_RATE'));
    const fullBefore = JSON.stringify(database.metric(ACCOUNT_ID, 'FULL_GROSS_SALES'));
    const snapshotBefore = JSON.stringify(database.snapshot(ACCOUNT_ID));
    database.failMetricUpdate = true;

    await assert.rejects(
      persistence.refreshGeFinanceMetrics({
        marketplaceAccountId: ACCOUNT_ID,
        businessDate: '2026-09-16',
        geFinanceReportSha256: 'e'.repeat(64),
        geFinanceDailySha256: 'f'.repeat(64),
        marginRate: new Prisma.Decimal('0.5'),
        marginAmount: new Prisma.Decimal('30'),
        marginBaseAmount: new Prisma.Decimal('60'),
        fullGrossSalesEvidenceAmount: new Prisma.Decimal('60'),
      }),
      /simulated local refresh failure/,
    );

    assert.equal(JSON.stringify(database.metric(ACCOUNT_ID, 'MARGIN_RATE')), marginBefore);
    assert.equal(JSON.stringify(database.metric(ACCOUNT_ID, 'FULL_GROSS_SALES')), fullBefore);
    assert.equal(JSON.stringify(database.snapshot(ACCOUNT_ID)), snapshotBefore);
  });

  it('persists all Full metrics with their own provenance', async () => {
    const database = new InMemoryDatabase();
    await service(database).persist(resolved(), metadata());

    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'FULL_SALES_COUNT')).toString(), '1');
    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'FULL_UNITS_SOLD')).toString(), '3');
    const gross = database.metric(ACCOUNT_ID, 'FULL_GROSS_SALES');
    assert.equal(decimalValue(gross).toString(), '48.9');
    assert.equal(gross.source, 'OLIST');
    assert.equal(gross.status, 'PROVISIONAL');
  });

  it('preserves divergence evidence and hash without paths, manual references or PII', async () => {
    const database = new InMemoryDatabase();
    const input = resolved();
    input.metrics.grossSales.validationEvidence = [
      {
        metric: 'grossSales',
        source: 'OLIST',
        value: '98.00',
        status: 'AVAILABLE',
        comparison: 'DIVERGENT',
        semantic: 'SUM(Olist totalProdutos)',
        absoluteDifference: '2.25',
        percentageDifference: '2.2444',
        notes: 'Comprador buyer@example.com, CPF 123.456.789-09, telefone 11999998888.',
        buyerName: 'Secret Person',
      } as never,
    ];
    const execution = {
      ...metadata(),
      geFinanceFilePath: 'C:\\private\\report.xlsx',
      sellerMetricsManualReference: 'MANUAL-SECRET',
    };

    await service(database).persist(input, execution);

    const stored = JSON.stringify({
      snapshots: [...database.snapshots.values()],
      metrics: [...database.metrics.values()],
    });
    const evidenceRows = database.metric(ACCOUNT_ID, 'GROSS_SALES')
      .validationEvidence as unknown as Array<Record<string, unknown>>;
    const evidence = evidenceRows[0];
    assert.ok(evidence);
    assert.equal(evidence.comparison, 'DIVERGENT');
    assert.equal(evidence.absoluteDifference, '2.25');
    assert.match(String(evidence.notes), /\[REDACTED\]/);
    assert.equal(stored.includes('buyer@example.com'), false);
    assert.equal(stored.includes('Secret Person'), false);
    assert.equal(stored.includes('report.xlsx'), false);
    assert.equal(stored.includes('MANUAL-SECRET'), false);
    assert.equal(database.snapshot(ACCOUNT_ID).geFinanceReportSha256, REPORT_HASH);
  });

  it('rolls back the snapshot and all metric rows when persistence fails', async () => {
    const database = new InMemoryDatabase();
    const persistence = service(database);
    await persistence.persist(resolved(), metadata());
    const before = decimalValue(database.metric(ACCOUNT_ID, 'GROSS_SALES')).toString();
    const changed = resolved();
    changed.metrics.grossSales.value = '777.77';
    database.failCreateMany = true;

    await assert.rejects(
      persistence.persist(changed, metadata()),
      /simulated transactional failure/,
    );

    assert.equal(database.snapshots.size, 1);
    assert.equal(database.metrics.size, 10);
    assert.equal(decimalValue(database.metric(ACCOUNT_ID, 'GROSS_SALES')).toString(), before);
  });
});

function service(database: InMemoryDatabase): DailySellerMetricsPersistenceService {
  return new DailySellerMetricsPersistenceService(
    database as unknown as DatabaseService,
  );
}

function metadata(marketplaceAccountId = ACCOUNT_ID) {
  return {
    marketplaceAccountId,
    geFinanceReportSha256: REPORT_HASH,
    geFinanceDailySha256: DAILY_HASH,
    geFinanceMarginAmount: '24',
    geFinanceMarginBaseAmount: '150.31',
    calculatedAt: new Date('2026-09-16T20:00:00.000Z'),
  };
}

function resolved(): ResolvedSellerBiMetrics {
  return {
    date: '2026-09-16',
    timeZone: 'America/Sao_Paulo',
    accountIsolation: {
      marketplace: 'EXACT_ID',
      olist: 'EXACT_ID',
      geFinance: 'ACCOUNT_CHANNEL_ALLOWLIST',
      excludedGeFinanceRecords: 1,
    },
    metrics: {
      salesCount: metric(2),
      unitsSold: metric(4),
      grossSales: metric('100.25', {
        status: 'PROVISIONAL',
        confidence: 'MEDIUM',
      }),
      marginRate: metric('15.9668874172', { source: 'GEFINANCE' }),
      fullClassification: metric('shipment.logistic_type = fulfillment'),
      fullSalesCount: metric(1),
      fullUnitsSold: metric(3),
      fullGrossSales: metric('48.90', {
        source: 'OLIST',
        status: 'PROVISIONAL',
        confidence: 'MEDIUM',
      }),
      visits: metric(1000),
      averageTicket: metric('50.125', {
        source: 'DERIVED',
        status: 'PROVISIONAL',
        confidence: 'MEDIUM',
      }),
      conversionRate: metric('0.2', { source: 'DERIVED' }),
    },
  };
}

function metric(
  value: string | number | null,
  overrides: Partial<ResolvedSellerBiMetric> = {},
): ResolvedSellerBiMetric {
  return {
    value,
    source: 'MERCADO_LIVRE',
    status: 'AVAILABLE',
    confidence: 'HIGH',
    validationEvidence: [],
    notes: [],
    ...overrides,
  };
}

interface StoredSnapshot {
  id: string;
  marketplaceAccountId: string;
  businessDate: Date;
  timezone: string;
  geFinanceReportSha256: string | null;
  geFinanceDailySha256: string | null;
  calculatedAt: Date;
}

interface StoredMetric extends Record<string, unknown> {
  dailySellerMetricsId: string;
  name: string;
  value: Prisma.Decimal | null;
  validationEvidence: Prisma.InputJsonValue;
}

interface SnapshotIdentity {
  where: {
    marketplaceAccountId_businessDate: {
      marketplaceAccountId: string;
      businessDate: Date;
    };
  };
}

interface SnapshotRangeQuery {
  where: {
    marketplaceAccountId: string;
    businessDate: { gte: Date; lte: Date };
  };
}

class InMemoryDatabase {
  snapshots = new Map<string, StoredSnapshot>();
  metrics = new Map<string, StoredMetric>();
  transactionCount = 0;
  transactionOptions: { maxWait?: number; timeout?: number } | undefined;
  failCreateMany = false;
  failMetricUpdate = false;
  findManyCount = 0;
  executeRawCount = 0;
  lastRawSql: string | undefined;
  private nextId = 1;

  readonly dailySellerMetrics = {
    findMany: async (args: SnapshotRangeQuery) => {
      this.findManyCount += 1;
      return [...this.snapshots.values()]
        .filter(
          (snapshot) =>
            snapshot.marketplaceAccountId === args.where.marketplaceAccountId &&
            snapshot.businessDate >= args.where.businessDate.gte &&
            snapshot.businessDate <= args.where.businessDate.lte,
        )
        .map((snapshot) => ({
          id: snapshot.id,
          businessDate: snapshot.businessDate,
          geFinanceReportSha256: snapshot.geFinanceReportSha256,
          geFinanceDailySha256: snapshot.geFinanceDailySha256,
        }));
    },
  };

  async $executeRaw(query: Prisma.Sql): Promise<number> {
    this.executeRawCount += 1;
    this.lastRawSql = query.sql;
    const values = query.values as unknown[];
    const marketplaceAccountId = String(values.at(-1));
    let updated = 0;
    for (let index = 0; index < values.length - 1; index += 2) {
      const id = String(values[index]);
      const sha256 = String(values[index + 1]);
      const snapshot = [...this.snapshots.values()].find(
        (candidate) =>
          candidate.id === id &&
          candidate.marketplaceAccountId === marketplaceAccountId,
      );
      if (snapshot?.geFinanceDailySha256 === null) {
        snapshot.geFinanceDailySha256 = sha256;
        updated += 1;
      }
    }
    return updated;
  }

  async $transaction<T>(
    callback: (transaction: object) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    this.transactionCount += 1;
    this.transactionOptions = options;
    const snapshots = new Map(this.snapshots);
    const metrics = new Map(this.metrics);
    const transaction = this.transaction(snapshots, metrics);
    const result = await callback(transaction);
    this.snapshots = snapshots;
    this.metrics = metrics;
    return result;
  }

  snapshot(accountId: string): StoredSnapshot {
    const value = this.snapshots.get(`${accountId}|2026-09-16`);
    assert.ok(value);
    return value;
  }

  metric(accountId: string, name: string): StoredMetric {
    const snapshot = this.snapshot(accountId);
    const value = this.metrics.get(`${snapshot.id}|${name}`);
    assert.ok(value);
    return value;
  }

  private transaction(
    snapshots: Map<string, StoredSnapshot>,
    metrics: Map<string, StoredMetric>,
  ) {
    return {
      dailySellerMetrics: {
        findUnique: async (args: SnapshotIdentity & { select?: { metrics?: unknown } }) => {
          const found = snapshots.get(snapshotKey(args));
          if (!found) return null;
          if (!args.select?.metrics) return { id: found.id };
          return {
            id: found.id,
            timezone: found.timezone,
            metrics: [...metrics.values()].filter(
              (metric) =>
                metric.dailySellerMetricsId === found.id &&
                (metric.name === 'MARGIN_RATE' || metric.name === 'FULL_GROSS_SALES'),
            ),
          };
        },
        update: async (args: { where: { id: string }; data: Partial<StoredSnapshot> }) => {
          const entry = [...snapshots.entries()].find(([, value]) => value.id === args.where.id);
          assert.ok(entry);
          snapshots.set(entry[0], { ...entry[1], ...args.data });
        },
        upsert: async (
          args: SnapshotIdentity & {
            create: Omit<StoredSnapshot, 'id'>;
            update: Partial<StoredSnapshot>;
          },
        ) => {
          const key = snapshotKey(args);
          const current = snapshots.get(key);
          const next: StoredSnapshot = current
            ? { ...current, ...args.update }
            : { id: `snapshot-${this.nextId++}`, ...args.create };
          snapshots.set(key, next);
          return { id: next.id };
        },
      },
      dailySellerMetric: {
        update: async (args: {
          where: {
            dailySellerMetricsId_name: {
              dailySellerMetricsId: string;
              name: string;
            };
          };
          data: Partial<StoredMetric>;
        }) => {
          const identity = args.where.dailySellerMetricsId_name;
          const key = `${identity.dailySellerMetricsId}|${identity.name}`;
          const current = metrics.get(key);
          assert.ok(current);
          if (this.failMetricUpdate && identity.name === 'FULL_GROSS_SALES') {
            throw new Error('simulated local refresh failure');
          }
          metrics.set(key, { ...current, ...args.data });
        },
        deleteMany: async (args: { where: { dailySellerMetricsId: string } }) => {
          for (const [key, value] of metrics) {
            if (value.dailySellerMetricsId === args.where.dailySellerMetricsId) {
              metrics.delete(key);
            }
          }
        },
        createMany: async (args: { data: StoredMetric[] }) => {
          for (const value of args.data) {
            metrics.set(`${value.dailySellerMetricsId}|${value.name}`, value);
            if (this.failCreateMany) {
              throw new Error('simulated transactional failure');
            }
          }
        },
      },
    };
  }
}

function snapshotKey(args: SnapshotIdentity): string {
  const identity = args.where.marketplaceAccountId_businessDate;
  return `${identity.marketplaceAccountId}|${identity.businessDate
    .toISOString()
    .slice(0, 10)}`;
}

function decimalValue(metric: StoredMetric): Prisma.Decimal {
  assert.ok(metric.value);
  return metric.value;
}
