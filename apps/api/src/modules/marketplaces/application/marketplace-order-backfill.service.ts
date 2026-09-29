import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Marketplace,
  MarketplaceAccount,
  MarketplaceOrderBackfillStatus,
  Prisma,
} from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  MARKETPLACE_ORDERS_PROVIDER,
  MarketplaceOrdersProvider,
} from '../domain/marketplace-orders.provider.js';
import {
  PersistenceCounts,
  persistMarketplaceOrder,
} from './orders-ingestion.service.js';
import {
  MERCADO_LIVRE_ACCOUNT_EXTERNAL_IDS,
  MercadoLivreAccountAlias,
} from '../mercado-livre/mercado-livre-accounts.js';
import {
  MercadoLivreClientError,
} from '../mercado-livre/mercado-livre.client.js';
import { withMercadoLivreRetry } from '../mercado-livre/mercado-livre-orders-retry.js';

const DAY_MS = 86_400_000;
const DEFAULT_PAGE_SIZE = 50;
const EXECUTION_LEASE_MS = 15 * 60 * 1_000;

export interface MarketplaceOrderBackfillOptions {
  account: MercadoLivreAccountAlias;
  dateFrom: Date;
  dateTo: Date;
  chunkDays?: number;
  maxRps?: number;
  maxAttempts?: number;
  stopAfterChunks?: number;
}

export interface MarketplaceOrderBackfillResumeOptions {
  account: MercadoLivreAccountAlias;
  runId: string;
  stopAfterChunks?: number;
}

export interface MarketplaceOrderBackfillEstimate {
  account: MercadoLivreAccountAlias;
  marketplaceAccountId: string;
  businessAccountId: string;
  dateFrom: string;
  dateTo: string;
  chunkDays: number;
  totalChunks: number;
  chunks: Array<{ dateFrom: string; dateTo: string }>;
}

export interface MarketplaceOrderBackfillSummary {
  runId: string;
  account: MercadoLivreAccountAlias;
  status: MarketplaceOrderBackfillStatus;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  attempts: number;
  pagesProcessed: number;
  ordersProcessed: number;
  itemsMapped: number;
  itemsUnmapped: number;
}

export type MarketplaceOrderBackfillErrorCode =
  | 'INVALID_OPTIONS'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_READY'
  | 'RUN_NOT_FOUND'
  | 'RUN_MISMATCH'
  | 'RUN_COMPLETED'
  | 'CONCURRENT_EXECUTION'
  | 'PARTIAL_CONTENT'
  | 'CHUNK_FAILED';

export class MarketplaceOrderBackfillError extends Error {
  constructor(
    readonly code: MarketplaceOrderBackfillErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceOrderBackfillError';
  }
}

interface AccountWithBusiness extends MarketplaceAccount {
  businessAccount: { id: string; code: string; active: boolean } | null;
}

interface ChunkWindow {
  dateFrom: Date;
  dateTo: Date;
}

@Injectable()
export class MarketplaceOrderBackfillService {
  private lastRequestStartedAt = 0;

  constructor(
    private readonly database: DatabaseService,
    @Inject(MARKETPLACE_ORDERS_PROVIDER)
    private readonly ordersProvider: MarketplaceOrdersProvider,
  ) {}

  async estimate(
    options: MarketplaceOrderBackfillOptions,
  ): Promise<MarketplaceOrderBackfillEstimate> {
    const normalized = normalizeOptions(options);
    const account = await this.loadAccount(normalized.account);
    const chunks = buildChunkWindows(
      normalized.dateFrom,
      normalized.dateTo,
      normalized.chunkDays,
    );
    return {
      account: normalized.account,
      marketplaceAccountId: account.id,
      businessAccountId: account.businessAccount!.id,
      dateFrom: normalized.dateFrom.toISOString(),
      dateTo: normalized.dateTo.toISOString(),
      chunkDays: normalized.chunkDays,
      totalChunks: chunks.length,
      chunks: chunks.map((chunk) => ({
        dateFrom: chunk.dateFrom.toISOString(),
        dateTo: chunk.dateTo.toISOString(),
      })),
    };
  }

  async start(
    options: MarketplaceOrderBackfillOptions,
  ): Promise<MarketplaceOrderBackfillSummary> {
    const normalized = normalizeOptions(options);
    const account = await this.loadAccount(normalized.account);
    const windows = buildChunkWindows(
      normalized.dateFrom,
      normalized.dateTo,
      normalized.chunkDays,
    );
    const executionId = randomUUID();
    let run: { id: string };
    try {
      run = await this.database.marketplaceOrderBackfillRun.create({
        data: {
          marketplaceAccountId: account.id,
          businessAccountId: account.businessAccount!.id,
          dateFrom: normalized.dateFrom,
          dateTo: normalized.dateTo,
          chunkDays: normalized.chunkDays,
          maxRps: new Prisma.Decimal(normalized.maxRps),
          maxAttempts: normalized.maxAttempts,
          status: MarketplaceOrderBackfillStatus.RUNNING,
          totalChunks: windows.length,
          executionId,
          heartbeatAt: new Date(),
          startedAt: new Date(),
          chunks: {
            create: windows.map((window) => ({
              dateFrom: window.dateFrom,
              dateTo: window.dateTo,
            })),
          },
        },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new MarketplaceOrderBackfillError(
          'CONCURRENT_EXECUTION',
          'There is already an active orders backfill for this account.',
        );
      }
      throw error;
    }

    return this.processRun(
      run.id,
      normalized.account,
      account,
      executionId,
      normalized.maxRps,
      normalized.maxAttempts,
      normalized.stopAfterChunks,
    );
  }

  async resume(
    options: MarketplaceOrderBackfillResumeOptions,
  ): Promise<MarketplaceOrderBackfillSummary> {
    validateStopAfterChunks(options.stopAfterChunks);
    const account = await this.loadAccount(options.account);
    const run = await this.database.marketplaceOrderBackfillRun.findUnique({
      where: { id: options.runId },
      select: {
        id: true,
        marketplaceAccountId: true,
        businessAccountId: true,
        status: true,
        maxRps: true,
        maxAttempts: true,
      },
    });
    if (!run) {
      throw new MarketplaceOrderBackfillError(
        'RUN_NOT_FOUND',
        'Marketplace order backfill run was not found.',
      );
    }
    if (
      run.marketplaceAccountId !== account.id ||
      run.businessAccountId !== account.businessAccount!.id
    ) {
      throw new MarketplaceOrderBackfillError(
        'RUN_MISMATCH',
        'The backfill run does not belong to the requested account.',
      );
    }
    if (run.status === MarketplaceOrderBackfillStatus.COMPLETED) {
      throw new MarketplaceOrderBackfillError(
        'RUN_COMPLETED',
        'The backfill run is already completed.',
      );
    }

    const executionId = randomUUID();
    const staleBefore = new Date(Date.now() - EXECUTION_LEASE_MS);
    const acquired = await this.database.marketplaceOrderBackfillRun.updateMany({
      where: {
        id: run.id,
        status: { not: MarketplaceOrderBackfillStatus.COMPLETED },
        OR: [
          { executionId: null },
          { heartbeatAt: null },
          { heartbeatAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: MarketplaceOrderBackfillStatus.RUNNING,
        executionId,
        heartbeatAt: new Date(),
        failedAt: null,
        lastError: null,
      },
    });
    if (acquired.count !== 1) {
      throw new MarketplaceOrderBackfillError(
        'CONCURRENT_EXECUTION',
        'This backfill run is already being executed.',
      );
    }

    return this.processRun(
      run.id,
      options.account,
      account,
      executionId,
      Number(run.maxRps),
      run.maxAttempts,
      options.stopAfterChunks,
    );
  }

  private async processRun(
    runId: string,
    alias: MercadoLivreAccountAlias,
    account: AccountWithBusiness,
    executionId: string,
    maxRps: number,
    maxAttempts: number,
    stopAfterChunks?: number,
  ): Promise<MarketplaceOrderBackfillSummary> {
    const chunks = await this.database.marketplaceOrderBackfillChunk.findMany({
      where: {
        runId,
        status: { not: MarketplaceOrderBackfillStatus.COMPLETED },
      },
      orderBy: { dateFrom: 'asc' },
    });
    let chunksProcessed = 0;

    for (const chunk of chunks) {
      if (
        stopAfterChunks !== undefined &&
        chunksProcessed >= stopAfterChunks
      ) {
        await this.releaseRun(
          runId,
          executionId,
          MarketplaceOrderBackfillStatus.PENDING,
        );
        return this.readSummary(runId, alias);
      }

      await this.database.marketplaceOrderBackfillChunk.update({
        where: { id: chunk.id },
        data: {
          status: MarketplaceOrderBackfillStatus.RUNNING,
          startedAt: chunk.startedAt ?? new Date(),
          completedAt: null,
          failedAt: null,
          lastError: null,
          partial: false,
        },
      });

      try {
        await this.processChunk(
          runId,
          chunk.id,
          chunk.dateFrom,
          chunk.dateTo,
          chunk.nextOffset,
          account,
          executionId,
          maxRps,
          maxAttempts,
        );
        chunksProcessed += 1;
      } catch (error: unknown) {
        const safeError = sanitizeBackfillError(error);
        await this.database.marketplaceOrderBackfillChunk.update({
          where: { id: chunk.id },
          data: {
            status: MarketplaceOrderBackfillStatus.FAILED,
            failedAt: new Date(),
            lastError: safeError,
            partial:
              error instanceof MarketplaceOrderBackfillError &&
              error.code === 'PARTIAL_CONTENT',
          },
        });
        await this.refreshRunTotals(
          runId,
          MarketplaceOrderBackfillStatus.FAILED,
          executionId,
          safeError,
        );
        throw new MarketplaceOrderBackfillError('CHUNK_FAILED', safeError);
      }
    }

    await this.refreshRunTotals(
      runId,
      MarketplaceOrderBackfillStatus.COMPLETED,
      executionId,
      null,
    );
    return this.readSummary(runId, alias);
  }

  private async processChunk(
    runId: string,
    chunkId: string,
    dateFrom: Date,
    dateTo: Date,
    initialOffset: number,
    account: AccountWithBusiness,
    executionId: string,
    maxRps: number,
    maxAttempts: number,
  ): Promise<void> {
    let offset = initialOffset;

    while (true) {
      const page = await withMercadoLivreRetry(
        () =>
          this.ordersProvider.listOrdersPage({
            marketplaceAccount: account,
            dateFrom,
            dateTo,
            offset,
            limit: DEFAULT_PAGE_SIZE,
            sort: 'date_asc',
          }),
        {
          maxAttempts,
          onAttempt: async () => {
            await this.throttle(maxRps);
            await this.database.$transaction([
              this.database.marketplaceOrderBackfillChunk.update({
                where: { id: chunkId },
                data: { attempts: { increment: 1 } },
              }),
              this.database.marketplaceOrderBackfillRun.update({
                where: { id: runId, executionId },
                data: {
                  heartbeatAt: new Date(),
                  attempts: { increment: 1 },
                },
              }),
            ]);
          },
        },
      );

      const totals = emptyPersistenceCounts();
      for (const order of page.orders) {
        addPersistenceCounts(
          totals,
          await this.database.$transaction((transaction) =>
            persistMarketplaceOrder(transaction, account.id, order),
          ),
        );
      }
      const itemCount = page.orders.reduce(
        (total, order) => total + order.items.length,
        0,
      );
      const mappedItems = itemCount - totals.unmappedItems;

      if (page.partial) {
        await this.database.marketplaceOrderBackfillChunk.update({
          where: { id: chunkId },
          data: {
            totalOrders: page.total,
            partial: true,
            lastError: 'Mercado Livre returned partial content (HTTP 206).',
          },
        });
        throw new MarketplaceOrderBackfillError(
          'PARTIAL_CONTENT',
          'Mercado Livre returned partial content (HTTP 206); the chunk remains incomplete.',
        );
      }

      const nextOffset = page.nextOffset ?? Math.max(page.total, page.offset);
      await this.database.$transaction([
        this.database.marketplaceOrderBackfillChunk.update({
          where: { id: chunkId },
          data: {
            nextOffset,
            totalOrders: page.total,
            pagesProcessed: { increment: 1 },
            ordersProcessed: { increment: page.orders.length },
            itemsMapped: { increment: mappedItems },
            itemsUnmapped: { increment: totals.unmappedItems },
            partial: false,
            status: page.hasMore
              ? MarketplaceOrderBackfillStatus.RUNNING
              : MarketplaceOrderBackfillStatus.COMPLETED,
            completedAt: page.hasMore ? null : new Date(),
          },
        }),
        this.database.marketplaceOrderBackfillRun.update({
          where: { id: runId, executionId },
          data: {
            heartbeatAt: new Date(),
            pagesProcessed: { increment: 1 },
            ordersProcessed: { increment: page.orders.length },
            itemsMapped: { increment: mappedItems },
            itemsUnmapped: { increment: totals.unmappedItems },
          },
        }),
      ]);

      if (!page.hasMore) return;
      offset = nextOffset;
    }
  }

  private async throttle(maxRps: number): Promise<void> {
    const minimumInterval = 1_000 / maxRps;
    const delay = Math.ceil(
      this.lastRequestStartedAt + minimumInterval - Date.now(),
    );
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    this.lastRequestStartedAt = Date.now();
  }

  private async loadAccount(
    alias: MercadoLivreAccountAlias,
  ): Promise<AccountWithBusiness> {
    const account = await this.database.marketplaceAccount.findUnique({
      where: {
        marketplace_externalAccountId: {
          marketplace: Marketplace.MERCADO_LIVRE,
          externalAccountId: MERCADO_LIVRE_ACCOUNT_EXTERNAL_IDS[alias],
        },
      },
      include: {
        businessAccount: {
          select: { id: true, code: true, active: true },
        },
      },
    });
    if (!account) {
      throw new MarketplaceOrderBackfillError(
        'ACCOUNT_NOT_FOUND',
        `Mercado Livre account ${alias.toUpperCase()} was not found.`,
      );
    }
    if (
      !account.active ||
      !account.businessAccount ||
      !account.businessAccount.active ||
      account.businessAccount.code.toLowerCase() !== alias
    ) {
      throw new MarketplaceOrderBackfillError(
        'ACCOUNT_NOT_READY',
        `Mercado Livre account ${alias.toUpperCase()} is inactive or is not linked to its business account.`,
      );
    }
    return account;
  }

  private async releaseRun(
    runId: string,
    executionId: string,
    status: MarketplaceOrderBackfillStatus,
  ): Promise<void> {
    await this.refreshRunTotals(runId, status, executionId, null);
  }

  private async refreshRunTotals(
    runId: string,
    status: MarketplaceOrderBackfillStatus,
    executionId: string,
    lastError: string | null,
  ): Promise<void> {
    const chunks = await this.database.marketplaceOrderBackfillChunk.findMany({
      where: { runId },
      select: {
        status: true,
        attempts: true,
        pagesProcessed: true,
        ordersProcessed: true,
        itemsMapped: true,
        itemsUnmapped: true,
      },
    });
    const now = new Date();
    await this.database.marketplaceOrderBackfillRun.update({
      where: { id: runId, executionId },
      data: {
        status,
        completedChunks: chunks.filter(
          (chunk) => chunk.status === MarketplaceOrderBackfillStatus.COMPLETED,
        ).length,
        failedChunks: chunks.filter(
          (chunk) => chunk.status === MarketplaceOrderBackfillStatus.FAILED,
        ).length,
        attempts: sum(chunks, 'attempts'),
        pagesProcessed: sum(chunks, 'pagesProcessed'),
        ordersProcessed: sum(chunks, 'ordersProcessed'),
        itemsMapped: sum(chunks, 'itemsMapped'),
        itemsUnmapped: sum(chunks, 'itemsUnmapped'),
        executionId: null,
        heartbeatAt: null,
        lastError,
        completedAt:
          status === MarketplaceOrderBackfillStatus.COMPLETED ? now : null,
        failedAt:
          status === MarketplaceOrderBackfillStatus.FAILED ? now : null,
      },
    });
  }

  private async readSummary(
    runId: string,
    account: MercadoLivreAccountAlias,
  ): Promise<MarketplaceOrderBackfillSummary> {
    const run = await this.database.marketplaceOrderBackfillRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        totalChunks: true,
        completedChunks: true,
        failedChunks: true,
        attempts: true,
        pagesProcessed: true,
        ordersProcessed: true,
        itemsMapped: true,
        itemsUnmapped: true,
      },
    });
    const { id, ...summary } = run;
    return { runId: id, account, ...summary };
  }
}

function normalizeOptions(options: MarketplaceOrderBackfillOptions) {
  const chunkDays = options.chunkDays ?? 1;
  const maxRps = options.maxRps ?? 1;
  const maxAttempts = options.maxAttempts ?? 5;
  if (
    Number.isNaN(options.dateFrom.getTime()) ||
    Number.isNaN(options.dateTo.getTime()) ||
    options.dateFrom >= options.dateTo
  ) {
    throw new MarketplaceOrderBackfillError(
      'INVALID_OPTIONS',
      '--from and --to must define a valid increasing interval.',
    );
  }
  if (!Number.isInteger(chunkDays) || chunkDays < 1 || chunkDays > 31) {
    throw new MarketplaceOrderBackfillError(
      'INVALID_OPTIONS',
      '--chunk-days must be an integer between 1 and 31.',
    );
  }
  if (!Number.isFinite(maxRps) || maxRps <= 0 || maxRps > 100) {
    throw new MarketplaceOrderBackfillError(
      'INVALID_OPTIONS',
      '--max-rps must be greater than 0 and at most 100.',
    );
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new MarketplaceOrderBackfillError(
      'INVALID_OPTIONS',
      '--max-attempts must be an integer between 1 and 20.',
    );
  }
  validateStopAfterChunks(options.stopAfterChunks);
  return {
    ...options,
    chunkDays,
    maxRps,
    maxAttempts,
  };
}

function validateStopAfterChunks(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new MarketplaceOrderBackfillError(
      'INVALID_OPTIONS',
      '--stop-after-chunks must be a positive integer.',
    );
  }
}

export function buildChunkWindows(
  dateFrom: Date,
  dateTo: Date,
  chunkDays: number,
): ChunkWindow[] {
  const windows: ChunkWindow[] = [];
  for (
    let cursor = dateFrom.getTime();
    cursor < dateTo.getTime();
    cursor += chunkDays * DAY_MS
  ) {
    windows.push({
      dateFrom: new Date(cursor),
      dateTo: new Date(Math.min(dateTo.getTime(), cursor + chunkDays * DAY_MS)),
    });
  }
  return windows;
}

function emptyPersistenceCounts(): PersistenceCounts {
  return {
    created: 0,
    updated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    unmappedItems: 0,
  };
}

function addPersistenceCounts(
  target: PersistenceCounts,
  source: PersistenceCounts,
): void {
  target.created += source.created;
  target.updated += source.updated;
  target.itemsCreated += source.itemsCreated;
  target.itemsUpdated += source.itemsUpdated;
  target.unmappedItems += source.unmappedItems;
}

function sum<T extends Record<K, number>, K extends keyof T>(
  rows: T[],
  field: K,
): number {
  return rows.reduce((total, row) => total + row[field], 0);
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

export function sanitizeBackfillError(error: unknown): string {
  if (
    error instanceof MarketplaceOrderBackfillError ||
    error instanceof MercadoLivreClientError
  ) {
    return error.message.slice(0, 500);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Database operation failed (${error.code}).`;
  }
  const name =
    error instanceof Error && /^[A-Za-z]+$/.test(error.name)
      ? error.name
      : 'UnknownError';
  return `Marketplace order backfill failed (${name}).`;
}
