import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import {
  MarketplaceOrderSyncResult,
  MarketplaceOrderSyncService,
} from './marketplace-order-sync.service.js';

export const INCREMENTAL_SYNC_INTERVAL_MS = 10 * 60 * 1_000;
export const DAILY_RECONCILIATION_HOUR = 3;
export const DAILY_RECONCILIATION_MINUTE = 20;
export const WEEKLY_RECONCILIATION_DAY = 0;
export const WEEKLY_RECONCILIATION_HOUR = 5;
export const WEEKLY_RECONCILIATION_MINUTE = 20;

@Injectable()
export class MarketplaceOrderSyncScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MarketplaceOrderSyncScheduler.name);
  private readonly timezone: string;
  private readonly enabled: boolean;
  private incrementalTimer?: NodeJS.Timeout;
  private dailyTimer?: NodeJS.Timeout;
  private weeklyTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly sync: MarketplaceOrderSyncService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.timezone = config.get('BUSINESS_TIMEZONE', { infer: true });
    this.enabled = config.get('MARKETPLACE_ORDER_SYNC_SCHEDULER_ENABLED', {
      infer: true,
    });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Mercado Livre order sync scheduler is disabled.');
      return;
    }
    this.stopped = false;
    this.scheduleIncremental();
    this.scheduleDaily();
    this.scheduleWeekly();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.incrementalTimer) clearTimeout(this.incrementalTimer);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    if (this.weeklyTimer) clearTimeout(this.weeklyTimer);
  }

  private scheduleIncremental(): void {
    if (this.stopped) return;
    const delay = millisecondsUntilNextInterval(
      new Date(),
      INCREMENTAL_SYNC_INTERVAL_MS,
    );
    this.incrementalTimer = setTimeout(() => {
      void this.execute('incremental').finally(() =>
        this.scheduleIncremental(),
      );
    }, delay);
    this.incrementalTimer.unref();
  }

  private scheduleDaily(): void {
    if (this.stopped) return;
    const delay = millisecondsUntilNextLocalTime(
      new Date(),
      this.timezone,
      DAILY_RECONCILIATION_HOUR,
      DAILY_RECONCILIATION_MINUTE,
    );
    this.dailyTimer = setTimeout(() => {
      void this.execute('daily').finally(() => this.scheduleDaily());
    }, delay);
    this.dailyTimer.unref();
  }

  private scheduleWeekly(): void {
    if (this.stopped) return;
    const delay = millisecondsUntilNextWeeklyLocalTime(
      new Date(),
      this.timezone,
      WEEKLY_RECONCILIATION_DAY,
      WEEKLY_RECONCILIATION_HOUR,
      WEEKLY_RECONCILIATION_MINUTE,
    );
    this.weeklyTimer = setTimeout(() => {
      void this.execute('weekly').finally(() => this.scheduleWeekly());
    }, delay);
    this.weeklyTimer.unref();
  }

  private async execute(
    kind: 'incremental' | 'daily' | 'weekly',
  ): Promise<void> {
    try {
      const result =
        kind === 'incremental'
          ? await this.sync.runIncremental()
          : kind === 'daily'
            ? await this.sync.runDailyReconciliation()
            : await this.sync.runWeeklyReconciliation();
      this.logResult(result);
    } catch (error: unknown) {
      this.logger.error(
        `${kind} Mercado Livre order sync failed (${safeErrorName(error)}).`,
      );
    }
  }

  private logResult(result: MarketplaceOrderSyncResult): void {
    const completed = result.accounts.filter(
      ({ status }) => status === 'completed',
    ).length;
    const skipped = result.accounts.length - completed;
    this.logger.log(
      `${result.kind} Mercado Livre order sync finished: ${completed} completed, ${skipped} skipped.`,
    );
  }
}

export function millisecondsUntilNextInterval(
  now: Date,
  intervalMs: number,
): number {
  return intervalMs - (now.getTime() % intervalMs);
}

export function millisecondsUntilNextLocalTime(
  now: Date,
  timezone: string,
  hour: number,
  minute: number,
): number {
  const parts = dateTimeParts(now, timezone);
  const todayTarget = localDateTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
    timezone,
  );
  const target =
    todayTarget > now
      ? todayTarget
      : localDateTimeToUtc(
          ...addCivilDays(parts.year, parts.month, parts.day, 1),
          hour,
          minute,
          timezone,
        );
  return target.getTime() - now.getTime();
}

export function millisecondsUntilNextWeeklyLocalTime(
  now: Date,
  timezone: string,
  weekday: number,
  hour: number,
  minute: number,
): number {
  const parts = dateTimeParts(now, timezone);
  const currentWeekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  const daysUntilTarget = (weekday - currentWeekday + 7) % 7;
  let targetDate = addCivilDays(
    parts.year,
    parts.month,
    parts.day,
    daysUntilTarget,
  );
  let target = localDateTimeToUtc(...targetDate, hour, minute, timezone);
  if (target <= now) {
    targetDate = addCivilDays(...targetDate, 7);
    target = localDateTimeToUtc(...targetDate, hour, minute, timezone);
  }
  return target.getTime() - now.getTime();
}

function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = dateTimeParts(new Date(candidate), timezone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
    );
    candidate -= representedAsUtc - targetAsUtc;
  }
  return new Date(candidate);
}

function dateTimeParts(date: Date, timezone: string) {
  const parts = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: parts.get('year')!,
    month: parts.get('month')!,
    day: parts.get('day')!,
    hour: parts.get('hour')!,
    minute: parts.get('minute')!,
  };
}

function addCivilDays(
  year: number,
  month: number,
  day: number,
  days: number,
): [number, number, number] {
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]+$/.test(error.name)
    ? error.name
    : 'UnknownError';
}
