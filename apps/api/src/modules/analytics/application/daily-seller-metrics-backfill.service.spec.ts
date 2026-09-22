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

  it('preserves timezone and report SHA-256 in every successful snapshot', async () => {
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

class PersistenceFake {
  readonly metadata: Array<{ geFinanceReportSha256: string }> = [];

  constructor(
    private readonly actions: Map<string, 'CREATED' | 'UPDATED'>,
  ) {}

  async persist(
    resolved: { date: string; timeZone: string },
    metadata: { geFinanceReportSha256: string },
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
      metricCount: 10,
      unavailableMetrics: [],
    };
  }
}
