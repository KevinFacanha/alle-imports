import { Injectable } from '@nestjs/common';
import {
  Marketplace,
  MarketplaceOrderBackfillStatus,
} from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  MarketplaceOrderBackfillError,
  MarketplaceOrderBackfillService,
  MarketplaceOrderBackfillSummary,
} from './marketplace-order-backfill.service.js';
import {
  MERCADO_LIVRE_ACCOUNT_EXTERNAL_IDS,
  MercadoLivreAccountAlias,
} from '../mercado-livre/mercado-livre-accounts.js';

export const INCREMENTAL_OVERLAP_MS = 2 * 60 * 60 * 1_000;
export const DAILY_RECONCILIATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const WEEKLY_RECONCILIATION_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const AUTOMATED_MAX_RPS = 1;
const AUTOMATED_MAX_ATTEMPTS = 5;
const ACCOUNTS = ['c1', 'c2'] as const;

export type MarketplaceOrderSyncKind =
  | 'incremental'
  | 'daily-reconciliation'
  | 'weekly-reconciliation';

export interface MarketplaceOrderSyncAccountResult {
  account: MercadoLivreAccountAlias;
  status: 'completed' | 'skipped';
  reason?: 'already-running' | 'account-not-ready';
  dateFrom?: string;
  dateTo?: string;
  summary?: MarketplaceOrderBackfillSummary;
}

export interface MarketplaceOrderSyncResult {
  kind: MarketplaceOrderSyncKind;
  startedAt: string;
  completedAt: string;
  accounts: MarketplaceOrderSyncAccountResult[];
}

@Injectable()
export class MarketplaceOrderSyncService {
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly backfill: MarketplaceOrderBackfillService,
  ) {}

  async runIncremental(now = new Date()): Promise<MarketplaceOrderSyncResult> {
    return this.run('incremental', now);
  }

  async runDailyReconciliation(
    now = new Date(),
  ): Promise<MarketplaceOrderSyncResult> {
    return this.run('daily-reconciliation', now);
  }

  async runWeeklyReconciliation(
    now = new Date(),
  ): Promise<MarketplaceOrderSyncResult> {
    return this.run('weekly-reconciliation', now);
  }

  private async run(
    kind: MarketplaceOrderSyncKind,
    now: Date,
  ): Promise<MarketplaceOrderSyncResult> {
    const startedAt = new Date();
    if (this.running) {
      return {
        kind,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        accounts: ACCOUNTS.map((account) => ({
          account,
          status: 'skipped',
          reason: 'already-running',
        })),
      };
    }

    this.running = true;
    try {
      const accounts: MarketplaceOrderSyncAccountResult[] = [];
      for (const account of ACCOUNTS) {
        accounts.push(await this.syncAccount(account, kind, now));
      }
      return {
        kind,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        accounts,
      };
    } finally {
      this.running = false;
    }
  }

  private async syncAccount(
    account: MercadoLivreAccountAlias,
    kind: MarketplaceOrderSyncKind,
    dateTo: Date,
  ): Promise<MarketplaceOrderSyncAccountResult> {
    const dateFrom =
      kind === 'daily-reconciliation'
        ? new Date(dateTo.getTime() - DAILY_RECONCILIATION_WINDOW_MS)
        : kind === 'weekly-reconciliation'
          ? new Date(dateTo.getTime() - WEEKLY_RECONCILIATION_WINDOW_MS)
          : await this.incrementalStart(account, dateTo);

    try {
      const summary = await this.backfill.start({
        account,
        dateFrom,
        dateTo,
        chunkDays: 1,
        maxRps: AUTOMATED_MAX_RPS,
        maxAttempts: AUTOMATED_MAX_ATTEMPTS,
      });
      return {
        account,
        status: 'completed',
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        summary,
      };
    } catch (error: unknown) {
      if (
        error instanceof MarketplaceOrderBackfillError &&
        error.code === 'CONCURRENT_EXECUTION'
      ) {
        return { account, status: 'skipped', reason: 'already-running' };
      }
      if (
        error instanceof MarketplaceOrderBackfillError &&
        (error.code === 'ACCOUNT_NOT_FOUND' ||
          error.code === 'ACCOUNT_NOT_READY')
      ) {
        return { account, status: 'skipped', reason: 'account-not-ready' };
      }
      throw error;
    }
  }

  private async incrementalStart(
    account: MercadoLivreAccountAlias,
    now: Date,
  ): Promise<Date> {
    const accountFilter = {
      marketplace: Marketplace.MERCADO_LIVRE,
      externalAccountId: MERCADO_LIVRE_ACCOUNT_EXTERNAL_IDS[account],
    } as const;
    const [latestOrder, latestCompletedRun] = await Promise.all([
      this.database.marketplaceOrder.aggregate({
        where: {
          marketplaceAccount: { is: accountFilter },
        },
        _max: { soldAt: true },
      }),
      this.database.marketplaceOrderBackfillRun.findFirst({
        where: {
          status: MarketplaceOrderBackfillStatus.COMPLETED,
          marketplaceAccount: { is: accountFilter },
        },
        orderBy: { dateTo: 'desc' },
        select: { dateTo: true },
      }),
    ]);
    const checkpoints = [
      latestOrder._max.soldAt,
      latestCompletedRun?.dateTo,
    ].filter((value): value is Date => value instanceof Date);
    const checkpoint = checkpoints.reduce<Date | null>(
      (latest, value) =>
        latest === null || value > latest ? value : latest,
      null,
    );
    const fallback = now.getTime() - WEEKLY_RECONCILIATION_WINDOW_MS;
    return new Date(
      checkpoint
        ? Math.min(
            checkpoint.getTime() - INCREMENTAL_OVERLAP_MS,
            now.getTime() - INCREMENTAL_OVERLAP_MS,
          )
        : fallback,
    );
  }
}
