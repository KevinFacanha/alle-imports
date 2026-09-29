import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Marketplace,
  MarketplaceAccount,
  MarketplaceOrderBackfillStatus,
  Prisma,
} from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  MarketplaceOrder,
  MarketplaceOrdersPage,
  MarketplaceOrderStatus,
} from '../domain/marketplace-order.types.js';
import { MarketplaceOrdersProvider } from '../domain/marketplace-orders.provider.js';
import { MercadoLivreClientError } from '../mercado-livre/mercado-livre.client.js';
import {
  MarketplaceOrderBackfillError,
  MarketplaceOrderBackfillService,
} from './marketplace-order-backfill.service.js';

const C1_ID = '00000000-0000-4000-8000-000000000001';
const C2_ID = '00000000-0000-4000-8000-000000000002';
const C1_BUSINESS_ID = 'c1000000-0000-4000-8000-000000000001';
const C2_BUSINESS_ID = 'c2000000-0000-4000-8000-000000000002';
const FROM = new Date('2026-09-01T00:00:00.000Z');
const TO = new Date('2026-09-02T00:00:00.000Z');

describe('MarketplaceOrderBackfillService', () => {
  it('persists page by page, maps listing+sellable, isolates C1/C2 and reprocesses idempotently', async () => {
    const database = new BackfillDatabase();
    database.addCatalog(C1_ID, 'MLB-A', 'VAR-1', 'listing-item-a');
    const provider = new BackfillProvider(() => database.orders.size);
    const service = makeService(database, provider);
    const shared = makeOrder({
      externalOrderId: 'shared-order',
      items: [
        makeItem({
          externalListingId: 'MLB-A',
          externalSellableId: 'VAR-1',
          sellerSku: 'SKU-IGNORED',
        }),
        makeItem({
          externalListingId: 'MLB-B',
          externalSellableId: 'VAR-1',
          sellerSku: 'SKU-IGNORED',
        }),
      ],
    });
    provider.enqueue(
      page([shared], 0, 50, 51),
      page([makeOrder({ externalOrderId: 'c1-second' })], 50, null, 51),
    );

    const first = await service.start(options('c1'));

    assert.equal(first.status, MarketplaceOrderBackfillStatus.COMPLETED);
    assert.equal(first.pagesProcessed, 2);
    assert.deepEqual(provider.orderCountsAtCall, [0, 1]);
    assert.equal(first.itemsMapped, 1);
    assert.equal(first.itemsUnmapped, 2);
    assert.equal(database.orders.size, 2);
    assert.equal(database.items.size, 3);
    const mapped = database.items.get(`${C1_ID}|shared-order|MLB-A|VAR-1`);
    const sameSellableOtherListing = database.items.get(
      `${C1_ID}|shared-order|MLB-B|VAR-1`,
    );
    assert.equal(mapped?.marketplaceListingItemId, 'listing-item-a');
    assert.equal(mapped?.productId, null);
    assert.equal(sameSellableOtherListing?.marketplaceListingItemId, null);
    assert.equal(database.productWrites, 0);
    assert.deepEqual(
      database.orders.get(`${C1_ID}|shared-order`)?.closedAt,
      new Date('2026-09-01T13:00:00.000Z'),
    );

    provider.enqueue(page([shared], 0, null, 1));
    await service.start(options('c1'));
    assert.equal(database.orders.size, 2);
    assert.equal(database.items.size, 3);

    provider.enqueue(page([shared], 0, null, 1));
    await service.start(options('c2'));
    assert.equal(database.orders.size, 3);
    assert.equal(database.items.size, 5);
    assert.ok(database.orders.has(`${C1_ID}|shared-order`));
    assert.ok(database.orders.has(`${C2_ID}|shared-order`));
  });

  it('checkpoints an offset and resumes only the incomplete day', async () => {
    const database = new BackfillDatabase();
    const provider = new BackfillProvider(() => database.orders.size);
    const service = makeService(database, provider);
    provider.enqueue(
      page([makeOrder({ externalOrderId: 'before-failure' })], 0, 50, 51),
      new MercadoLivreClientError('bad request', 'REQUEST_FAILED', 400),
    );

    await assert.rejects(service.start(options('c1')), (error: unknown) => {
      assert.ok(error instanceof MarketplaceOrderBackfillError);
      assert.equal(error.code, 'CHUNK_FAILED');
      return true;
    });
    const runId = [...database.runs.keys()][0]!;
    const chunk = [...database.chunks.values()][0]!;
    assert.equal(chunk.status, MarketplaceOrderBackfillStatus.FAILED);
    assert.equal(chunk.nextOffset, 50);
    assert.equal(database.orders.size, 1);

    provider.enqueue(
      page([makeOrder({ externalOrderId: 'after-resume' })], 50, null, 51),
    );
    const resumed = await service.resume({ account: 'c1', runId });

    assert.equal(resumed.status, MarketplaceOrderBackfillStatus.COMPLETED);
    assert.deepEqual(provider.offsets, [0, 50, 50]);
    assert.equal(database.orders.size, 2);
    assert.equal(chunk.pagesProcessed, 2);
  });

  it('persists a 206 page but never marks its chunk completed', async () => {
    const database = new BackfillDatabase();
    const provider = new BackfillProvider(() => database.orders.size);
    provider.enqueue({
      ...page([makeOrder({ externalOrderId: 'partial-order' })], 0, null, 1),
      partial: true,
    });

    await assert.rejects(makeService(database, provider).start(options('c1')));

    const chunk = [...database.chunks.values()][0]!;
    assert.equal(chunk.status, MarketplaceOrderBackfillStatus.FAILED);
    assert.equal(chunk.partial, true);
    assert.equal(chunk.nextOffset, 0);
    assert.equal(chunk.pagesProcessed, 0);
    assert.ok(database.orders.has(`${C1_ID}|partial-order`));
  });

  it('estimates one-day chunks without creating a run', async () => {
    const database = new BackfillDatabase();
    const service = makeService(
      database,
      new BackfillProvider(() => database.orders.size),
    );
    const estimate = await service.estimate({
      ...options('c2'),
      dateTo: new Date('2026-09-04T00:00:00.000Z'),
    });

    assert.equal(estimate.totalChunks, 3);
    assert.equal(database.runs.size, 0);
  });
});

class BackfillProvider implements MarketplaceOrdersProvider {
  private readonly responses: Array<MarketplaceOrdersPage | Error> = [];
  readonly offsets: number[] = [];
  readonly orderCountsAtCall: number[] = [];

  constructor(private readonly orderCount: () => number) {}

  enqueue(...responses: Array<MarketplaceOrdersPage | Error>): void {
    this.responses.push(...responses);
  }

  async listOrdersPage(
    params: Parameters<MarketplaceOrdersProvider['listOrdersPage']>[0],
  ): Promise<MarketplaceOrdersPage> {
    this.offsets.push(params.offset ?? 0);
    this.orderCountsAtCall.push(this.orderCount());
    const response = this.responses.shift();
    if (!response) throw new Error('Missing fake page.');
    if (response instanceof Error) throw response;
    return response;
  }

  async listOrders(): Promise<{ orders: MarketplaceOrder[]; partial: boolean }> {
    throw new Error('Backfill must use listOrdersPage.');
  }
}

interface StoredRun extends Record<string, unknown> {
  id: string;
  marketplaceAccountId: string;
  businessAccountId: string;
  status: MarketplaceOrderBackfillStatus;
  executionId: string | null;
  heartbeatAt: Date | null;
  maxRps: Prisma.Decimal;
  maxAttempts: number;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  attempts: number;
  pagesProcessed: number;
  ordersProcessed: number;
  itemsMapped: number;
  itemsUnmapped: number;
}

interface StoredChunk extends Record<string, unknown> {
  id: string;
  runId: string;
  dateFrom: Date;
  dateTo: Date;
  status: MarketplaceOrderBackfillStatus;
  nextOffset: number;
  totalOrders: number | null;
  attempts: number;
  pagesProcessed: number;
  ordersProcessed: number;
  itemsMapped: number;
  itemsUnmapped: number;
  partial: boolean;
  startedAt: Date | null;
}

class BackfillDatabase {
  readonly accounts = new Map<string, MarketplaceAccount & {
    businessAccount: { id: string; code: string; active: boolean };
  }>([
    ['740458955', account(C1_ID, C1_BUSINESS_ID, 'C1', '740458955')],
    ['1196767962', account(C2_ID, C2_BUSINESS_ID, 'C2', '1196767962')],
  ]);
  readonly runs = new Map<string, StoredRun>();
  readonly chunks = new Map<string, StoredChunk>();
  readonly orders = new Map<string, Record<string, unknown>>();
  readonly items = new Map<string, Record<string, unknown>>();
  readonly catalog = new Map<string, string>();
  productWrites = 0;
  private runSequence = 0;
  private chunkSequence = 0;

  readonly marketplaceAccount = {
    findUnique: async (args: AccountFindArgs) =>
      this.accounts.get(
        args.where.marketplace_externalAccountId.externalAccountId,
      ) ?? null,
  };

  readonly marketplaceOrderBackfillRun = {
    create: async (args: RunCreateArgs) => {
      const id = `10000000-0000-4000-8000-${String(++this.runSequence).padStart(12, '0')}`;
      const data = args.data;
      const run: StoredRun = {
        ...data,
        id,
        status: data.status,
        executionId: data.executionId,
        heartbeatAt: data.heartbeatAt,
        maxRps: data.maxRps,
        maxAttempts: data.maxAttempts,
        totalChunks: data.totalChunks,
        completedChunks: 0,
        failedChunks: 0,
        attempts: 0,
        pagesProcessed: 0,
        ordersProcessed: 0,
        itemsMapped: 0,
        itemsUnmapped: 0,
      };
      this.runs.set(id, run);
      for (const window of data.chunks.create) {
        const chunkId = `20000000-0000-4000-8000-${String(++this.chunkSequence).padStart(12, '0')}`;
        this.chunks.set(chunkId, {
          id: chunkId,
          runId: id,
          dateFrom: window.dateFrom,
          dateTo: window.dateTo,
          status: MarketplaceOrderBackfillStatus.PENDING,
          nextOffset: 0,
          totalOrders: null,
          attempts: 0,
          pagesProcessed: 0,
          ordersProcessed: 0,
          itemsMapped: 0,
          itemsUnmapped: 0,
          partial: false,
          startedAt: null,
        });
      }
      return { id };
    },
    findUnique: async (args: IdArgs) => this.runs.get(args.where.id) ?? null,
    findUniqueOrThrow: async (args: IdArgs) => {
      const run = this.runs.get(args.where.id);
      if (!run) throw new Error('Run not found.');
      return run;
    },
    updateMany: async (args: RunUpdateManyArgs) => {
      const run = this.runs.get(args.where.id);
      if (!run || run.executionId !== null) return { count: 0 };
      applyData(run, args.data);
      return { count: 1 };
    },
    update: async (args: UpdateArgs) => {
      const run = this.runs.get(args.where.id);
      if (!run) throw new Error('Run not found.');
      if (
        args.where.executionId !== undefined &&
        run.executionId !== args.where.executionId
      ) {
        throw new Error('Execution lease mismatch.');
      }
      applyData(run, args.data);
      return run;
    },
  };

  readonly marketplaceOrderBackfillChunk = {
    findMany: async (args: ChunkFindArgs) => {
      const rows = [...this.chunks.values()].filter(
        (chunk) =>
          chunk.runId === args.where.runId &&
          (args.where.status?.not === undefined ||
            chunk.status !== args.where.status.not),
      );
      return rows.sort((a, b) => a.dateFrom.getTime() - b.dateFrom.getTime());
    },
    update: async (args: UpdateArgs) => {
      const chunk = this.chunks.get(args.where.id);
      if (!chunk) throw new Error('Chunk not found.');
      applyData(chunk, args.data);
      return chunk;
    },
  };

  addCatalog(
    accountId: string,
    listingId: string,
    sellableId: string,
    listingItemId: string,
  ): void {
    this.catalog.set(`${accountId}|${listingId}|${sellableId}`, listingItemId);
  }

  async $transaction(input: unknown): Promise<unknown> {
    if (Array.isArray(input)) return Promise.all(input);
    if (typeof input === 'function') {
      return (input as (transaction: unknown) => Promise<unknown>)(this.transaction);
    }
    throw new Error('Unsupported transaction.');
  }

  private readonly transaction = {
    marketplaceOrderBackfillRun: this.marketplaceOrderBackfillRun,
    marketplaceOrderBackfillChunk: this.marketplaceOrderBackfillChunk,
    marketplaceOrder: {
      findUnique: async (args: OrderIdentityArgs) => {
        const identity = args.where.marketplaceAccountId_externalOrderId;
        const stored = this.orders.get(
          `${identity.marketplaceAccountId}|${identity.externalOrderId}`,
        );
        return stored ? { id: stored.id } : null;
      },
      upsert: async (args: OrderUpsertArgs) => {
        const identity = args.where.marketplaceAccountId_externalOrderId;
        const key = `${identity.marketplaceAccountId}|${identity.externalOrderId}`;
        const existing = this.orders.get(key);
        const id = String(existing?.id ?? `order-${this.orders.size + 1}`);
        this.orders.set(key, {
          ...existing,
          ...(existing ? args.update : args.create),
          id,
        });
        return { id };
      },
    },
    marketplaceListing: {
      findUnique: async (args: ListingIdentityArgs) => {
        const listing = args.where.marketplaceAccountId_externalListingId;
        const sellable = args.select.items.where.externalSellableId;
        const id = this.catalog.get(
          `${listing.marketplaceAccountId}|${listing.externalListingId}|${sellable}`,
        );
        return id ? { items: [{ id }] } : null;
      },
    },
    marketplaceOrderItem: {
      findUnique: async (args: ItemIdentityArgs) => {
        const identity =
          args.where.marketplaceOrderId_externalListingId_externalSellableId;
        const key = this.itemKeyFromPersistedOrder(identity);
        const stored = this.items.get(key);
        return stored ? { id: stored.id } : null;
      },
      upsert: async (args: ItemUpsertArgs) => {
        const identity =
          args.where.marketplaceOrderId_externalListingId_externalSellableId;
        const key = this.itemKeyFromPersistedOrder(identity);
        const existing = this.items.get(key);
        const id = String(existing?.id ?? `item-${this.items.size + 1}`);
        this.items.set(key, {
          ...existing,
          ...(existing ? args.update : args.create),
          id,
          productId: existing?.productId ?? null,
        });
        return { id };
      },
    },
  };

  private itemKeyFromPersistedOrder(identity: ItemIdentity): string {
    const order = [...this.orders.entries()].find(
      ([, value]) => value.id === identity.marketplaceOrderId,
    );
    if (!order) throw new Error('Persisted order not found.');
    return `${order[0]}|${identity.externalListingId}|${identity.externalSellableId}`;
  }
}

interface AccountFindArgs {
  where: {
    marketplace_externalAccountId: {
      marketplace: Marketplace;
      externalAccountId: string;
    };
  };
}

interface RunCreateArgs {
  data: {
    marketplaceAccountId: string;
    businessAccountId: string;
    status: MarketplaceOrderBackfillStatus;
    executionId: string;
    heartbeatAt: Date;
    maxRps: Prisma.Decimal;
    maxAttempts: number;
    totalChunks: number;
    chunks: { create: Array<{ dateFrom: Date; dateTo: Date }> };
  } & Record<string, unknown>;
}

interface IdArgs { where: { id: string } }
interface RunUpdateManyArgs extends UpdateArgs {
  where: UpdateArgs['where'] & Record<string, unknown>;
}
interface UpdateArgs {
  where: { id: string; executionId?: string };
  data: Record<string, unknown>;
}
interface ChunkFindArgs {
  where: {
    runId: string;
    status?: { not?: MarketplaceOrderBackfillStatus };
  };
}
interface OrderIdentity {
  marketplaceAccountId: string;
  externalOrderId: string;
}
interface OrderIdentityArgs {
  where: { marketplaceAccountId_externalOrderId: OrderIdentity };
}
interface OrderUpsertArgs extends OrderIdentityArgs {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
interface ListingIdentityArgs {
  where: {
    marketplaceAccountId_externalListingId: {
      marketplaceAccountId: string;
      externalListingId: string;
    };
  };
  select: { items: { where: { externalSellableId: string } } };
}
interface ItemIdentity {
  marketplaceOrderId: string;
  externalListingId: string;
  externalSellableId: string;
}
interface ItemIdentityArgs {
  where: {
    marketplaceOrderId_externalListingId_externalSellableId: ItemIdentity;
  };
}
interface ItemUpsertArgs extends ItemIdentityArgs {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

function applyData(
  target: Record<string, unknown>,
  data: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(data)) {
    if (isIncrement(value)) {
      target[key] = Number(target[key] ?? 0) + value.increment;
    } else {
      target[key] = value;
    }
  }
}

function isIncrement(value: unknown): value is { increment: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { increment?: unknown }).increment === 'number'
  );
}

function makeService(
  database: BackfillDatabase,
  provider: MarketplaceOrdersProvider,
): MarketplaceOrderBackfillService {
  return new MarketplaceOrderBackfillService(
    database as unknown as DatabaseService,
    provider,
  );
}

function options(accountAlias: 'c1' | 'c2') {
  return {
    account: accountAlias,
    dateFrom: FROM,
    dateTo: TO,
    maxRps: 100,
    maxAttempts: 1,
  };
}

function account(
  id: string,
  businessAccountId: string,
  code: string,
  externalAccountId: string,
) {
  return {
    id,
    businessAccountId,
    marketplace: Marketplace.MERCADO_LIVRE,
    externalAccountId,
    name: code,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    businessAccount: { id: businessAccountId, code, active: true },
  };
}

function page(
  orders: MarketplaceOrder[],
  offset: number,
  nextOffset: number | null,
  total: number,
): MarketplaceOrdersPage {
  return {
    orders,
    offset,
    nextOffset,
    total,
    partial: false,
    hasMore: nextOffset !== null,
  };
}

function makeOrder(overrides: Partial<MarketplaceOrder> = {}): MarketplaceOrder {
  return {
    externalOrderId: 'order-1',
    rawStatus: 'paid',
    normalizedStatus: MarketplaceOrderStatus.Paid,
    soldAt: new Date('2026-09-01T12:00:00.000Z'),
    closedAt: new Date('2026-09-01T13:00:00.000Z'),
    lastUpdatedAt: new Date('2026-09-01T14:00:00.000Z'),
    cancelledAt: null,
    currency: 'BRL',
    grossAmount: new Prisma.Decimal('10'),
    paidAmount: new Prisma.Decimal('10'),
    refundedAmount: new Prisma.Decimal('0'),
    items: [makeItem()],
    ...overrides,
  };
}

function makeItem(
  overrides: Partial<MarketplaceOrder['items'][number]> = {},
): MarketplaceOrder['items'][number] {
  return {
    externalListingId: 'MLB-DEFAULT',
    externalSellableId: 'MLB-DEFAULT',
    userProductId: 'USER-1',
    catalogProductId: 'CATALOG-1',
    sellerSku: 'DUPLICATED-SKU',
    title: 'Produto',
    quantity: 1,
    unitPrice: new Prisma.Decimal('10'),
    grossAmount: new Prisma.Decimal('10'),
    ...overrides,
  };
}
