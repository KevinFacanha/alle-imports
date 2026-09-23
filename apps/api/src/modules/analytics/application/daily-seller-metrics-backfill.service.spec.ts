import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GeFinanceReportError } from '../../integrations/gefinance/gefinance-report.provider.js';
import {
  calendarDateRange,
  DailySellerMetricsBackfillError,
  DailySellerMetricsBackfillService,
} from './daily-seller-metrics-backfill.service.js';

const MARKETPLACE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const OLIST_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const REPORT_HASH = 'b'.repeat(64);
const DAILY_HASHES = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];
const DAILY_DAYS = ['2026-09-01', '2026-09-02', '2026-09-03'].map(
  (businessDate, index) => ({
    businessDate,
    recordCount: index + 1,
    sha256: DAILY_HASHES[index]!,
  }),
);

describe('DailySellerMetricsBackfillService', () => {
  it('processes days sequentially, isolates a failure and reports CREATED and UPDATED', async () => {
    const reconciliation = new ReconciliationFake('2026-09-02');
    const resolver = new ResolverFake();
    const persistence = new PersistenceFake(
      new Map([
        ['2026-09-01', 'CREATED'],
        ['2026-09-03', 'UPDATED'],
      ]),
    );
    const provider = { getFinancialEvidence: async () => ({}) };
    let providerCreations = 0;
    const service = new DailySellerMetricsBackfillService(
      reconciliation as never,
      resolver as never,
      persistence as never,
      () => {
        providerCreations += 1;
        return provider as never;
      },
    );

    const result = await service.execute(params());

    assert.equal(result.daysProcessed, 3);
    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 0);
    assert.deepEqual(
      result.days.map(({ date, action }) => [date, action]),
      [
        ['2026-09-01', 'CREATED'],
        ['2026-09-02', 'FAILED'],
        ['2026-09-03', 'UPDATED'],
      ],
    );
    assert.match(
      result.days[1]?.reason ?? '',
      /^GeFinanceReportError\/INVALID_VALUE:/,
    );
    assert.equal(result.snapshots.length, 2);
    assert.equal(providerCreations, 1);
    assert.equal(reconciliation.maximumConcurrentCalls, 1);
    assert.deepEqual(reconciliation.completedDates, [
      '2026-09-01',
      '2026-09-03',
    ]);
    assert.ok(
      reconciliation.calls.every(
        (call) => call.geFinanceProvider === provider,
      ),
    );
  });

  it('resumes the same report from only the missing days', async () => {
    const reconciliation = new ReconciliationFake();
    const persistence = new PersistenceFake(
      new Map([['2026-09-02', 'UPDATED'], ['2026-09-03', 'UPDATED']]),
      existingSnapshots(['2026-09-01']),
    );
    const progress: unknown[] = [];
    const service = new DailySellerMetricsBackfillService(
      reconciliation as never,
      new ResolverFake() as never,
      persistence as never,
      () => ({ getFinancialEvidence: async () => ({}) }) as never,
    );

    const result = await service.execute(
      params({ onProgress: (entry) => progress.push(entry) }),
    );

    assert.equal(result.skipped, 1);
    assert.equal(result.daysProcessed, 2);
    assert.deepEqual(reconciliation.completedDates, ['2026-09-02', '2026-09-03']);
    assert.deepEqual(progress, [
      { index: 1, total: 3, date: '2026-09-01', state: 'COMPLETED', action: 'SKIPPED' },
      { index: 2, total: 3, date: '2026-09-02', state: 'PROCESSING' },
      { index: 2, total: 3, date: '2026-09-02', state: 'COMPLETED', action: 'UPDATED' },
      { index: 3, total: 3, date: '2026-09-03', state: 'PROCESSING' },
      { index: 3, total: 3, date: '2026-09-03', state: 'COMPLETED', action: 'UPDATED' },
    ]);
  });

  it('preserves timezone plus report and daily SHA-256 in every successful snapshot', async () => {
    const persistence = new PersistenceFake(
      new Map([
        ['2026-09-01', 'CREATED'],
        ['2026-09-02', 'CREATED'],
        ['2026-09-03', 'CREATED'],
      ]),
    );
    const service = new DailySellerMetricsBackfillService(
      new ReconciliationFake() as never,
      new ResolverFake() as never,
      persistence as never,
      () => ({ getFinancialEvidence: async () => ({}) }) as never,
    );

    const result = await service.execute(params());

    assert.equal(result.snapshots.length, 3);
    assert.ok(
      result.snapshots.every(
        (snapshot) =>
          snapshot.timezone === 'America/Sao_Paulo' &&
          snapshot.geFinanceReportSha256 === REPORT_HASH,
      ),
    );
    assert.deepEqual(
      persistence.metadata.map((metadata) => metadata.geFinanceReportSha256),
      [REPORT_HASH, REPORT_HASH, REPORT_HASH],
    );
    assert.deepEqual(
      persistence.metadata.map((metadata) => metadata.geFinanceDailySha256),
      DAILY_HASHES,
    );
  });

  it('skips the same XLSX entirely without creating a provider or reconciling', async () => {
    const reconciliation = new ReconciliationFake();
    const persistence = new PersistenceFake(new Map(), existingSnapshots(
      DAILY_DAYS.map(({ businessDate }) => businessDate),
    ));
    let providerCreations = 0;
    const service = new DailySellerMetricsBackfillService(
      reconciliation as never,
      new ResolverFake() as never,
      persistence as never,
      () => {
        providerCreations += 1;
        return { getFinancialEvidence: async () => ({}) } as never;
      },
    );

    const result = await service.execute(params());

    assert.equal(result.daysFound, 3);
    assert.equal(result.skipped, 3);
    assert.equal(result.daysProcessed, 0);
    assert.equal(result.externalProcessingDays, 0);
    assert.equal(persistence.findExistingSnapshotsCalls, 1);
    assert.equal(providerCreations, 0);
    assert.equal(reconciliation.calls.length, 0);
    assert.deepEqual(result.days.map(({ action }) => action), [
      'SKIPPED',
      'SKIPPED',
      'SKIPPED',
    ]);
  });

  it('processes only a newly appended business date', async () => {
    const reconciliation = new ReconciliationFake();
    const persistence = new PersistenceFake(
      new Map([['2026-09-03', 'CREATED']]),
      existingSnapshots(['2026-09-01', '2026-09-02']),
    );
    const service = new DailySellerMetricsBackfillService(
      reconciliation as never,
      new ResolverFake() as never,
      persistence as never,
      () => ({ getFinancialEvidence: async () => ({}) }) as never,
    );

    const result = await service.execute(params());

    assert.equal(result.skipped, 2);
    assert.equal(result.created, 1);
    assert.equal(result.externalProcessingDays, 1);
    assert.deepEqual(reconciliation.completedDates, ['2026-09-03']);
  });

  it('updates only the old business date whose daily content changed', async () => {
    const reconciliation = new ReconciliationFake();
    const existing = existingSnapshots(
      DAILY_DAYS.map(({ businessDate }) => businessDate),
    );
    existing.set('2026-09-02', {
      geFinanceReportSha256: REPORT_HASH,
      geFinanceDailySha256: 'f'.repeat(64),
    });
    const persistence = new PersistenceFake(
      new Map([['2026-09-02', 'UPDATED']]),
      existing,
    );
    const service = new DailySellerMetricsBackfillService(
      reconciliation as never,
      new ResolverFake() as never,
      persistence as never,
      () => ({ getFinancialEvidence: async () => ({}) }) as never,
    );

    const result = await service.execute(params());

    assert.equal(result.skipped, 2);
    assert.equal(result.updated, 1);
    assert.equal(result.externalProcessingDays, 1);
    assert.deepEqual(reconciliation.completedDates, ['2026-09-02']);
  });

  it('blocks a legacy snapshot before provider creation or external reconciliation', async () => {
    const reconciliation = new ReconciliationFake();
    const persistence = new PersistenceFake(
      new Map(),
      new Map([
        [
          '2026-09-01',
          {
            geFinanceReportSha256: REPORT_HASH,
            geFinanceDailySha256: null,
          },
        ],
      ]),
    );
    let providerCreations = 0;
    const service = new DailySellerMetricsBackfillService(
      reconciliation as never,
      new ResolverFake() as never,
      persistence as never,
      () => {
        providerCreations += 1;
        return { getFinancialEvidence: async () => ({}) } as never;
      },
    );

    await assert.rejects(
      service.execute(
        params({
          from: '2026-09-01',
          to: '2026-09-01',
          geFinanceDays: [DAILY_DAYS[0]!],
        }),
      ),
      /backfill:gefinance:daily-hashes/,
    );

    assert.equal(providerCreations, 0);
    assert.equal(reconciliation.calls.length, 0);
    assert.equal(persistence.metadata.length, 0);
  });

  it('generates inclusive UTC calendar dates without timezone drift or duplicates', () => {
    assert.deepEqual(calendarDateRange('2026-09-01', '2026-09-03'), [
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    assert.deepEqual(calendarDateRange('2024-02-28', '2024-03-01'), [
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
  });

  it('rejects invalid and reversed periods before creating a provider', async () => {
    let providerCreations = 0;
    const service = new DailySellerMetricsBackfillService(
      new ReconciliationFake() as never,
      new ResolverFake() as never,
      new PersistenceFake(new Map()) as never,
      () => {
        providerCreations += 1;
        return { getFinancialEvidence: async () => ({}) } as never;
      },
    );

    await assert.rejects(
      service.execute(params({ from: '2026-09-31' })),
      DailySellerMetricsBackfillError,
    );
    await assert.rejects(
      service.execute(params({ from: '2026-09-04', to: '2026-09-03' })),
      /from must be on or before to/,
    );
    assert.equal(providerCreations, 0);
  });
});

function params(
  overrides: Partial<Parameters<DailySellerMetricsBackfillService['execute']>[0]> = {},
) {
  return {
    marketplaceAccountId: MARKETPLACE_ACCOUNT_ID,
    olistAccountId: OLIST_ACCOUNT_ID,
    geFinanceReportPath: '/private/gefinance.xlsx',
    geFinanceReportSha256: REPORT_HASH,
    from: '2026-09-01',
    to: '2026-09-03',
    geFinanceDays: DAILY_DAYS,
    ...overrides,
  };
}

interface ReconciliationCall {
  date: string;
  geFinanceProvider: unknown;
}

class ReconciliationFake {
  readonly calls: ReconciliationCall[] = [];
  readonly completedDates: string[] = [];
  maximumConcurrentCalls = 0;
  private activeCalls = 0;

  constructor(private readonly failureDate?: string) {}

  async reconcile(call: ReconciliationCall) {
    this.calls.push(call);
    this.activeCalls += 1;
    this.maximumConcurrentCalls = Math.max(
      this.maximumConcurrentCalls,
      this.activeCalls,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.activeCalls -= 1;
    if (call.date === this.failureDate) {
      throw new GeFinanceReportError(
        'INVALID_VALUE',
        'Invalid financial value for this business date.',
      );
    }
    this.completedDates.push(call.date);
    return { date: call.date, timeZone: 'America/Sao_Paulo' };
  }
}

class ResolverFake {
  resolve(value: { date: string; timeZone: string }) {
    return value;
  }
}

interface ExistingSnapshot {
  geFinanceReportSha256: string | null;
  geFinanceDailySha256: string | null;
}

class PersistenceFake {
  readonly metadata: Array<{
    geFinanceReportSha256: string;
    geFinanceDailySha256: string | null;
  }> = [];
  findExistingSnapshotsCalls = 0;

  constructor(
    private readonly actions: Map<string, 'CREATED' | 'UPDATED'>,
    private readonly existing = new Map<string, ExistingSnapshot>(),
  ) {}

  async findExistingSnapshots() {
    this.findExistingSnapshotsCalls += 1;
    return new Map(this.existing);
  }

  async persist(
    resolved: { date: string; timeZone: string },
    metadata: {
      geFinanceReportSha256: string;
      geFinanceDailySha256: string | null;
    },
  ) {
    this.metadata.push(metadata);
    const action = this.actions.get(resolved.date) ?? 'CREATED';
    return {
      marketplaceAccountId: MARKETPLACE_ACCOUNT_ID,
      businessDate: resolved.date,
      timezone: resolved.timeZone,
      action,
      calculatedAt: '2026-09-22T12:00:00.000Z',
      geFinanceReportSha256: metadata.geFinanceReportSha256,
      geFinanceDailySha256: metadata.geFinanceDailySha256,
      metricCount: 10,
      unavailableMetrics: [],
    };
  }
}

function existingSnapshots(dates: readonly string[]): Map<string, ExistingSnapshot> {
  return new Map(
    dates.map((date) => {
      const day = DAILY_DAYS.find(({ businessDate }) => businessDate === date)!;
      return [
        date,
        {
          geFinanceReportSha256: REPORT_HASH,
          geFinanceDailySha256: day.sha256,
        },
      ];
    }),
  );
}
