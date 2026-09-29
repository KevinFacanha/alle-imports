import {
  MercadoLivreClientError,
} from './mercado-livre.client.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onAttempt?: (attempt: number) => Promise<void> | void;
}

export async function withMercadoLivreRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer.');
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    await options.onAttempt?.(attempt);
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isRetryable(error) || attempt === options.maxAttempts) throw error;
      const retryAfterMs =
        error.code === 'RATE_LIMITED'
          ? parseRetryAfterMs(error.retryAfter, now())
          : null;
      const exponentialMs = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1),
      );
      const jitterMs = Math.floor(random() * Math.max(1, baseDelayMs));
      await sleep(
        retryAfterMs ?? Math.min(maxDelayMs, exponentialMs + jitterMs),
      );
    }
  }

  throw new Error('Mercado Livre retry loop ended unexpectedly.');
}

export function isRetryable(error: unknown): error is MercadoLivreClientError {
  return (
    error instanceof MercadoLivreClientError &&
    (error.code === 'RATE_LIMITED' ||
      error.code === 'UPSTREAM_UNAVAILABLE' ||
      error.code === 'TIMEOUT')
  );
}

export function parseRetryAfterMs(
  value: string | undefined,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - nowMs);
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
