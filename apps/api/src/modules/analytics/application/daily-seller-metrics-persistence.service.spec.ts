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
    const grossSales = database.metric(ACCOUNT_ID, 'GROSS_SALES');
    assert.ok(grossSales.value instanceof Prisma.Decimal);
    assert.equal(grossSales.value.toString(), '100.25');
    assert.equal(grossSales.source, 'MERCADO_LIVRE');
    assert.equal(grossSales.status, 'PROVISIONAL');
    assert.equal(grossSales.confidence, 'MEDIUM');
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

class InMemoryDatabase {
  snapshots = new Map<string, StoredSnapshot>();
  metrics = new Map<string, StoredMetric>();
  transactionCount = 0;
  transactionOptions: { maxWait?: number; timeout?: number } | undefined;
  failCreateMany = false;
  private nextId = 1;

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
        findUnique: async (args: SnapshotIdentity) => {
          const found = snapshots.get(snapshotKey(args));
          return found ? { id: found.id } : null;
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
