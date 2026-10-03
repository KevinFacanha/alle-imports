import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MarketplaceOrderBackfillStatus } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  MarketplaceOrderBackfillError,
  MarketplaceOrderBackfillService,
  MarketplaceOrderBackfillSummary,
} from './marketplace-order-backfill.service.js';
import {
  INCREMENTAL_OVERLAP_MS,
  DAILY_RECONCILIATION_WINDOW_MS,
  MarketplaceOrderSyncService,
  WEEKLY_RECONCILIATION_WINDOW_MS,
} from './marketplace-order-sync.service.js';

const NOW = new Date('2026-10-03T15:00:00.000Z');

describe('MarketplaceOrderSyncService', () => {
  it('syncs C1 and C2 from each persisted checkpoint with overlap', async () => {
    const database = new SyncDatabase(
      [
        new Date('2026-10-03T14:50:00.000Z'),
        new Date('2026-10-03T14:40:00.000Z'),
      ],
      [null, null],
    );
    const backfill = new BackfillFake();

    const result = await makeService(database, backfill).runIncremental(NOW);

    assert.equal(result.accounts.length, 2);
    assert.deepEqual(
      backfill.calls.map(({ account, dateFrom, dateTo }) => ({
        account,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
      })),
      [
        {
          account: 'c1',
          dateFrom: new Date(
            Date.parse('2026-10-03T14:50:00.000Z') - INCREMENTAL_OVERLAP_MS,
          ).toISOString(),
          dateTo: NOW.toISOString(),
        },
        {
          account: 'c2',
          dateFrom: new Date(
            Date.parse('2026-10-03T14:40:00.000Z') - INCREMENTAL_OVERLAP_MS,
          ).toISOString(),
          dateTo: NOW.toISOString(),
        },
      ],
    );
    assert.ok(backfill.calls.every(({ maxRps }) => maxRps === 1));
    assert.ok(backfill.calls.every(({ maxAttempts }) => maxAttempts === 5));
  });

  it('reuses the last completed run checkpoint when no order exists', async () => {
    const checkpoint = new Date('2026-10-03T14:30:00.000Z');
    const backfill = new BackfillFake();
    await makeService(
      new SyncDatabase([null, null], [checkpoint, checkpoint]),
      backfill,
    ).runIncremental(NOW);

    assert.ok(
      backfill.calls.every(
        ({ dateFrom }) =>
          dateFrom.getTime() === checkpoint.getTime() - INCREMENTAL_OVERLAP_MS,
      ),
    );
  });

  it('uses a 7-day window for both accounts during daily reconciliation', async () => {
    const backfill = new BackfillFake();
    await makeService(new SyncDatabase([]), backfill).runDailyReconciliation(NOW);

    assert.deepEqual(
      backfill.calls.map(({ account, dateFrom }) => ({
        account,
        dateFrom: dateFrom.toISOString(),
      })),
      ['c1', 'c2'].map((account) => ({
        account,
        dateFrom: new Date(
          NOW.getTime() - DAILY_RECONCILIATION_WINDOW_MS,
        ).toISOString(),
      })),
    );
  });

  it('uses a 90-day window for both accounts during weekly reconciliation', async () => {
    const backfill = new BackfillFake();
    await makeService(new SyncDatabase([]), backfill).runWeeklyReconciliation(NOW);

    assert.ok(
      backfill.calls.every(
        ({ dateFrom }) =>
          dateFrom.getTime() === NOW.getTime() - WEEKLY_RECONCILIATION_WINDOW_MS,
      ),
    );
  });

  it('blocks a concurrent execution in-process', async () => {
    const backfill = new BackfillFake();
    backfill.block = true;
    const service = makeService(new SyncDatabase([NOW, NOW]), backfill);
    const first = service.runIncremental(NOW);
    await backfill.started;

    const concurrentWeekly = await service.runWeeklyReconciliation(NOW);
    const concurrentDaily = await service.runDailyReconciliation(NOW);
    assert.ok(
      concurrentWeekly.accounts.every(({ status }) => status === 'skipped'),
    );
    assert.ok(
      concurrentWeekly.accounts.every(
        ({ reason }) => reason === 'already-running',
      ),
    );
    assert.ok(
      concurrentDaily.accounts.every(({ status }) => status === 'skipped'),
    );
    assert.ok(
      concurrentDaily.accounts.every(
        ({ reason }) => reason === 'already-running',
      ),
    );

    backfill.release();
    await first;
  });

  it('skips only the account protected by the database concurrency lease', async () => {
    const backfill = new BackfillFake();
    backfill.concurrentAccount = 'c1';
    const result = await makeService(
      new SyncDatabase([NOW, NOW]),
      backfill,
    ).runIncremental(NOW);

    assert.deepEqual(
      result.accounts.map(({ account, status, reason }) => ({ account, status, reason })),
      [
        { account: 'c1', status: 'skipped', reason: 'already-running' },
        { account: 'c2', status: 'completed', reason: undefined },
      ],
    );
  });
});

class SyncDatabase {
  private orderIndex = 0;
  private runIndex = 0;
  readonly marketplaceOrder = {
    aggregate: async () => ({
      _max: { soldAt: this.orderCheckpoints[this.orderIndex++] ?? null },
    }),
  };
  readonly marketplaceOrderBackfillRun = {
    findFirst: async () => {
      const dateTo = this.runCheckpoints[this.runIndex++] ?? null;
      return dateTo ? { dateTo } : null;
    },
  };

  constructor(
    private readonly orderCheckpoints: Array<Date | null>,
    private readonly runCheckpoints: Array<Date | null> = [],
  ) {}
}

class BackfillFake {
  readonly calls: Array<Parameters<MarketplaceOrderBackfillService['start']>[0]> = [];
  concurrentAccount?: 'c1' | 'c2';
  block = false;
  private unblock?: () => void;
  private markStarted?: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async start(
    options: Parameters<MarketplaceOrderBackfillService['start']>[0],
  ): Promise<MarketplaceOrderBackfillSummary> {
    this.calls.push(options);
    this.markStarted?.();
    if (this.concurrentAccount === options.account) {
      throw new MarketplaceOrderBackfillError(
        'CONCURRENT_EXECUTION',
        'already running',
      );
    }
    if (this.block) {
      await new Promise<void>((resolve) => {
        this.unblock = resolve;
      });
      this.block = false;
    }
    return {
      runId: `${options.account}-run`,
      account: options.account,
      status: MarketplaceOrderBackfillStatus.COMPLETED,
      totalChunks: 1,
      completedChunks: 1,
      failedChunks: 0,
      attempts: 1,
      pagesProcessed: 1,
      ordersProcessed: 1,
      itemsMapped: 1,
      itemsUnmapped: 0,
      ordersCreated: 0,
      ordersUpdated: 1,
      itemsCreated: 0,
      itemsUpdated: 1,
    };
  }

  release(): void {
    this.unblock?.();
  }
}

function makeService(
  database: SyncDatabase,
  backfill: BackfillFake,
): MarketplaceOrderSyncService {
  return new MarketplaceOrderSyncService(
    database as unknown as DatabaseService,
    backfill as unknown as MarketplaceOrderBackfillService,
  );
}
