import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import { OlistAuthorizationService } from './olist-authorization.service.js';

export const OLIST_TOKEN_KEEPER_INTERVAL_MS = 5 * 60_000;
export const OLIST_TOKEN_KEEPER_INITIAL_JITTER_MS = 15_000;
export const OLIST_TOKEN_KEEPER_RETRY_DELAYS_MS = [15_000, 60_000] as const;

@Injectable()
export class OlistTokenKeeperScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OlistTokenKeeperScheduler.name);
  private readonly enabled: boolean;
  private cycleTimer?: NodeJS.Timeout;
  private readonly retryTimers = new Map<NodeJS.Timeout, () => void>();
  private stopped = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: OlistAuthorizationService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled = config.get('OLIST_TOKEN_KEEPER_ENABLED', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.stopped = false;
    const initialJitter = Math.floor(
      Math.random() * OLIST_TOKEN_KEEPER_INITIAL_JITTER_MS,
    );
    this.scheduleCycle(initialJitter);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    for (const [timer, resolve] of this.retryTimers) {
      clearTimeout(timer);
      resolve();
    }
    this.retryTimers.clear();
  }

  async runOnce(): Promise<void> {
    const activeAuthorizations =
      await this.database.olistAuthorization.findMany({
        where: { status: 'ACTIVE' },
        select: { olistAccountId: true, integrationKey: true },
      });

    await Promise.all(
      activeAuthorizations.map(({ olistAccountId, integrationKey }) =>
        this.refreshWithRetry(olistAccountId, integrationKey),
      ),
    );
  }

  private scheduleCycle(delayMs: number): void {
    if (this.stopped) return;
    this.cycleTimer = setTimeout(() => {
      void this.runOnce()
        .catch((error: unknown) => {
          this.logger.error(
            JSON.stringify({
              integrationKey: 'scheduler',
              result: 'SKIPPED',
              accessRemainingMinutes: null,
              refreshRemainingMinutes: null,
              error: safeError(error),
            }),
          );
        })
        .finally(() => {
          this.scheduleCycle(OLIST_TOKEN_KEEPER_INTERVAL_MS);
        });
    }, delayMs);
    this.cycleTimer.unref();
  }

  private async refreshWithRetry(
    olistAccountId: string,
    integrationKey: string,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt <= OLIST_TOKEN_KEEPER_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      if (this.stopped) return;
      try {
        const result = await this.authorization.refreshIfDue(olistAccountId);
        if (result.outcome !== 'RETRY') return;
      } catch (error: unknown) {
        this.logger.error(
          JSON.stringify({
            integrationKey,
            result: 'SKIPPED',
            accessRemainingMinutes: null,
            refreshRemainingMinutes: null,
            error: safeError(error),
          }),
        );
        return;
      }

      const delay = OLIST_TOKEN_KEEPER_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return;
      await this.waitForRetry(delay);
    }
  }

  private waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        resolve();
      }, delayMs);
      this.retryTimers.set(timer, resolve);
      timer.unref();
    });
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown_error';
}
