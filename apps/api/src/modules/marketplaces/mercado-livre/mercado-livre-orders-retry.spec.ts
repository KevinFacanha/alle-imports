import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MercadoLivreClientError,
} from './mercado-livre.client.js';
import {
  parseRetryAfterMs,
  withMercadoLivreRetry,
} from './mercado-livre-orders-retry.js';

describe('withMercadoLivreRetry', () => {
  it('retries 429 using Retry-After and then succeeds', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withMercadoLivreRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new MercadoLivreClientError(
            'rate limited',
            'RATE_LIMITED',
            429,
            '2',
          );
        }
        return 'ok';
      },
      {
        maxAttempts: 5,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );

    assert.equal(result, 'ok');
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2_000]);
  });

  it('retries 5xx, timeout and network failures with bounded backoff', async () => {
    const failures = [
      new MercadoLivreClientError('5xx', 'UPSTREAM_UNAVAILABLE', 503),
      new MercadoLivreClientError('timeout', 'TIMEOUT'),
      new MercadoLivreClientError('network', 'UPSTREAM_UNAVAILABLE'),
    ];
    const delays: number[] = [];
    let calls = 0;
    await withMercadoLivreRetry(
      async () => {
        const failure = failures[calls];
        calls += 1;
        if (failure) throw failure;
        return undefined;
      },
      {
        maxAttempts: 5,
        baseDelayMs: 10,
        random: () => 0,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );

    assert.equal(calls, 4);
    assert.deepEqual(delays, [10, 20, 40]);
  });

  it('does not retry 400 or 403', async () => {
    for (const error of [
      new MercadoLivreClientError('bad request', 'REQUEST_FAILED', 400),
      new MercadoLivreClientError('forbidden', 'ACCESS_DENIED', 403),
    ]) {
      let calls = 0;
      await assert.rejects(
        withMercadoLivreRetry(
          async () => {
            calls += 1;
            throw error;
          },
          { maxAttempts: 5, sleep: async () => undefined },
        ),
        error,
      );
      assert.equal(calls, 1);
    }
  });

  it('stops after maxAttempts', async () => {
    let calls = 0;
    await assert.rejects(
      withMercadoLivreRetry(
        async () => {
          calls += 1;
          throw new MercadoLivreClientError('timeout', 'TIMEOUT');
        },
        {
          maxAttempts: 5,
          sleep: async () => undefined,
        },
      ),
      /timeout/,
    );
    assert.equal(calls, 5);
  });

  it('parses HTTP-date Retry-After values', () => {
    assert.equal(
      parseRetryAfterMs('Tue, 29 Sep 2026 12:00:02 GMT', Date.UTC(2026, 8, 29, 12)),
      2_000,
    );
  });
});
