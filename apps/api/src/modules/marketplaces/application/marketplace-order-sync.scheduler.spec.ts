import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import {
  MarketplaceOrderSyncScheduler,
  millisecondsUntilNextInterval,
  millisecondsUntilNextLocalTime,
  millisecondsUntilNextWeeklyLocalTime,
} from './marketplace-order-sync.scheduler.js';
import { MarketplaceOrderSyncService } from './marketplace-order-sync.service.js';

describe('MarketplaceOrderSyncScheduler', () => {
  it('aligns incremental execution to the next 10-minute boundary', () => {
    assert.equal(
      millisecondsUntilNextInterval(
        new Date('2026-10-03T15:07:30.000Z'),
        10 * 60 * 1_000,
      ),
      150_000,
    );
  });

  it('schedules the daily reconciliation at 03:20 America/Sao_Paulo', () => {
    const before = new Date('2026-10-03T05:00:00.000Z');
    const after = new Date('2026-10-03T07:00:00.000Z');
    assert.equal(
      millisecondsUntilNextLocalTime(
        before,
        'America/Sao_Paulo',
        3,
        20,
      ),
      80 * 60 * 1_000,
    );
    assert.equal(
      millisecondsUntilNextLocalTime(
        after,
        'America/Sao_Paulo',
        3,
        20,
      ),
      23 * 60 * 60 * 1_000 + 20 * 60 * 1_000,
    );
  });

  it('schedules the 90-day reconciliation for Sunday at 05:20 Sao Paulo', () => {
    const saturday = new Date('2026-10-03T15:00:00.000Z');
    assert.equal(
      millisecondsUntilNextWeeklyLocalTime(
        saturday,
        'America/Sao_Paulo',
        0,
        5,
        20,
      ),
      17 * 60 * 60 * 1_000 + 20 * 60 * 1_000,
    );
  });

  it('keeps every scheduler timer OFF when not explicitly enabled', () => {
    assert.equal(scheduledTimerCount(false), 0);
  });

  it('enables incremental, daily and weekly timers when explicitly configured', () => {
    assert.equal(scheduledTimerCount(true), 3);
  });
});

function scheduledTimerCount(enabled: boolean): number {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = 0;
  globalThis.setTimeout = (() => {
    scheduled += 1;
    return { unref: () => undefined } as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    const config = {
      get: (key: keyof EnvironmentVariables) =>
        key === 'BUSINESS_TIMEZONE' ? 'America/Sao_Paulo' : enabled,
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const scheduler = new MarketplaceOrderSyncScheduler(
      {} as MarketplaceOrderSyncService,
      config,
    );
    scheduler.onApplicationBootstrap();
    scheduler.onApplicationShutdown();
    return scheduled;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}
