import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  OlistAuthorizationService,
  OlistTokenRefreshResult,
} from './olist-authorization.service.js';
import {
  OLIST_TOKEN_KEEPER_RETRY_DELAYS_MS,
  OlistTokenKeeperScheduler,
} from './olist-token-keeper.scheduler.js';

const ACCOUNT_A_ID = '30000000-0000-4000-8000-000000000001';
const ACCOUNT_B_ID = '30000000-0000-4000-8000-000000000002';

describe('OlistTokenKeeperScheduler', () => {
  it('keeps the scheduler disabled by default', () => {
    const scheduledDelays: number[] = [];
    withFakeTimers(scheduledDelays, () => {
      const scheduler = makeScheduler([], [], undefined);
      scheduler.onApplicationBootstrap();
      scheduler.onApplicationShutdown();
    });

    assert.deepEqual(scheduledDelays, []);
  });

  it('uses its own flag and schedules a small initial jitter', () => {
    const scheduledDelays: number[] = [];
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      withFakeTimers(scheduledDelays, () => {
        const scheduler = makeScheduler([], [], true);
        scheduler.onApplicationBootstrap();
        scheduler.onApplicationShutdown();
      });
    } finally {
      Math.random = originalRandom;
    }

    assert.deepEqual(scheduledDelays, [7_500]);
  });

  it('processes active C1 and C2 authorizations independently', async () => {
    const calls: string[] = [];
    const scheduler = makeScheduler(
      [
        { olistAccountId: ACCOUNT_A_ID, integrationKey: 'c1' },
        { olistAccountId: ACCOUNT_B_ID, integrationKey: 'c2' },
      ],
      calls,
      false,
    );

    await scheduler.runOnce();

    assert.deepEqual(calls.sort(), [ACCOUNT_A_ID, ACCOUNT_B_ID]);
  });

  it('retries only after 15s and 60s, reacquiring through refreshIfDue each time', async () => {
    const calls: string[] = [];
    const outcomes: OlistTokenRefreshResult[] = [
      retryResult(),
      retryResult(),
      retryResult(),
    ];
    const scheduler = makeScheduler(
      [{ olistAccountId: ACCOUNT_A_ID, integrationKey: 'c1' }],
      calls,
      false,
      outcomes,
    );
    const scheduledDelays: number[] = [];

    await withFakeTimersAsync(scheduledDelays, () => scheduler.runOnce());

    assert.deepEqual(scheduledDelays, [...OLIST_TOKEN_KEEPER_RETRY_DELAYS_MS]);
    assert.deepEqual(calls, [ACCOUNT_A_ID, ACCOUNT_A_ID, ACCOUNT_A_ID]);
  });
});

function retryResult(): OlistTokenRefreshResult {
  return {
    integrationKey: 'c1',
    outcome: 'RETRY',
    accessRemainingMinutes: 1,
    refreshRemainingMinutes: 60,
    error: 'timeout',
  };
}

function makeScheduler(
  active: Array<{ olistAccountId: string; integrationKey: string }>,
  calls: string[],
  enabled: boolean | undefined,
  outcomes: OlistTokenRefreshResult[] = [],
): OlistTokenKeeperScheduler {
  const database = {
    olistAuthorization: {
      findMany: async (args: { where: { status: string } }) => {
        assert.equal(args.where.status, 'ACTIVE');
        return active;
      },
    },
  } as unknown as DatabaseService;
  const authorization = {
    refreshIfDue: async (olistAccountId: string) => {
      calls.push(olistAccountId);
      return (
        outcomes.shift() ?? {
          integrationKey:
            active.find((item) => item.olistAccountId === olistAccountId)
              ?.integrationKey ?? 'c2',
          outcome: 'SKIPPED',
          accessRemainingMinutes: 30,
          refreshRemainingMinutes: 180,
        }
      );
    },
  } as unknown as OlistAuthorizationService;
  const config = {
    get: (key: keyof EnvironmentVariables) =>
      key === 'OLIST_TOKEN_KEEPER_ENABLED' ? (enabled ?? false) : undefined,
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new OlistTokenKeeperScheduler(database, authorization, config);
}

function withFakeTimers(delays: number[], operation: () => void): void {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((
    _callback: (...args: unknown[]) => void,
    delay?: number,
  ) => {
    delays.push(delay ?? 0);
    return { unref: () => undefined } as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    operation();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

async function withFakeTimersAsync(
  delays: number[],
  operation: () => Promise<void>,
): Promise<void> {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
  ) => {
    delays.push(delay ?? 0);
    queueMicrotask(callback);
    return { unref: () => undefined } as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    await operation();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}
