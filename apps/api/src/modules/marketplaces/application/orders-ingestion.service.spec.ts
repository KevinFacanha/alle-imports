import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Marketplace,
  MarketplaceAccount,
  Prisma,
} from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  MarketplaceOrder,
  MarketplaceOrderStatus,
} from '../domain/marketplace-order.types.js';
import { MarketplaceOrdersProvider } from '../domain/marketplace-orders.provider.js';
import {
  OrdersIngestionError,
  OrdersIngestionService,
} from './orders-ingestion.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const DATE_FROM = new Date('2026-09-01T00:00:00.000Z');
const DATE_TO = new Date('2026-09-02T00:00:00.000Z');
const ACCESS_TOKEN = 'secret-access-token-that-must-never-leak';

describe('OrdersIngestionService', () => {
  it('imports an order and an unmapped item on the first ingestion', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    const provider = new OrdersProviderFake([makeOrder()]);
    const summary = await makeService(database, provider).ingest(params());

    assert.deepEqual(summary, {
      marketplaceAccountId: ACCOUNT_ID,
      dateFrom: DATE_FROM.toISOString(),
      dateTo: DATE_TO.toISOString(),
      fetched: 1,
      created: 1,
      updated: 0,
      itemsCreated: 1,
      itemsUpdated: 0,
      unmappedItems: 1,
      partial: false,
    });
    assert.equal(database.orders.size, 1);
    assert.equal(database.items.size, 1);
    assert.equal([...database.items.values()][0]?.externalListingId, 'MLB1000');
    assert.equal([...database.items.values()][0]?.marketplaceListingItemId, null);
    assert.equal([...database.items.values()][0]?.productId, null);
    assert.equal(database.transactionCount, 1);
    assert.equal(provider.calls[0]?.marketplaceAccount.externalAccountId, 'seller-123');
  });

  it('reprocesses without duplicates and updates status, cancellation and snapshots', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    const provider = new OrdersProviderFake([makeOrder()]);
    const service = makeService(database, provider);
    await service.ingest(params());

    provider.orders = [
      makeOrder({
        rawStatus: 'cancelled',
        normalizedStatus: MarketplaceOrderStatus.Cancelled,
        cancelledAt: new Date('2026-09-01T15:00:00.000Z'),
        grossAmount: money('44.00'),
        items: [
          makeItem({ title: 'Título atualizado', grossAmount: money('44.00') }),
        ],
      }),
    ];
    const summary = await service.ingest(params());

    assert.equal(summary.created, 0);
    assert.equal(summary.updated, 1);
    assert.equal(summary.itemsCreated, 0);
    assert.equal(summary.itemsUpdated, 1);
    assert.equal(database.orders.size, 1);
    assert.equal(database.items.size, 1);
    const order = [...database.orders.values()][0];
    const item = [...database.items.values()][0];
    assert.equal(order?.normalizedStatus, 'CANCELLED');
    assert.deepEqual(order?.cancelledAt, new Date('2026-09-01T15:00:00.000Z'));
    assert.equal(order?.grossAmount, '44');
    assert.equal(item?.title, 'Título atualizado');
    assert.equal(item?.grossAmount, '44');
  });

  it('persists order and item monetary snapshots as Decimal values', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    const provider = new OrdersProviderFake([
      makeOrder({
        grossAmount: money('1234.56'),
        items: [
          makeItem({
            quantity: 3,
            unitPrice: money('0.10'),
            grossAmount: money('0.37'),
          }),
        ],
      }),
    ]);

    await makeService(database, provider).ingest(params());

    const order = [...database.orders.values()][0];
    const item = [...database.items.values()][0];
    assert.equal(order?.grossAmount, '1234.56');
    assert.equal(item?.unitPrice, '0.1');
    assert.equal(item?.grossAmount, '0.37');
  });

  it('maps a listing item from the same account and inherits its productId', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    database.addCatalogItem({
      marketplaceAccountId: ACCOUNT_ID,
      externalListingId: 'MLB1000',
      externalSellableId: 'variation-1',
      id: 'listing-item-1',
      productId: 'product-1',
    });
    const provider = new OrdersProviderFake([
      makeOrder({ items: [makeItem({ externalSellableId: 'variation-1' })] }),
    ]);

    const summary = await makeService(database, provider).ingest(params());
    const item = [...database.items.values()][0];

    assert.equal(summary.unmappedItems, 0);
    assert.equal(item?.marketplaceListingItemId, 'listing-item-1');
    assert.equal(item?.productId, 'product-1');
  });

  it('keeps identical external identities isolated between two accounts', async () => {
    const database = new InMemoryDatabase([
      makeAccount(),
      makeAccount({
        id: SECOND_ACCOUNT_ID,
        externalAccountId: 'seller-456',
      }),
    ]);
    const provider = new OrdersProviderFake([makeOrder()]);
    const service = makeService(database, provider);

    const first = await service.ingest(params());
    const second = await service.ingest({
      ...params(),
      marketplaceAccountId: SECOND_ACCOUNT_ID,
    });

    assert.equal(first.created, 1);
    assert.equal(second.created, 1);
    assert.equal(database.orders.size, 2);
    assert.deepEqual(
      new Set([...database.orders.values()].map((order) => order.marketplaceAccountId)),
      new Set([ACCOUNT_ID, SECOND_ACCOUNT_ID]),
    );
  });

  it('persists valid orders and propagates partial=true', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    const provider = new OrdersProviderFake([makeOrder()], true);

    const summary = await makeService(database, provider).ingest(params());

    assert.equal(summary.partial, true);
    assert.equal(summary.created, 1);
    assert.equal(database.orders.size, 1);
  });

  it('rolls back only the failing order transaction', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    database.failOnSellableId = 'fail-item';
    const provider = new OrdersProviderFake([
      makeOrder({ externalOrderId: 'order-committed' }),
      makeOrder({
        externalOrderId: 'order-rolled-back',
        items: [
          makeItem({ externalSellableId: 'item-before-failure' }),
          makeItem({ externalSellableId: 'fail-item' }),
        ],
      }),
    ]);

    await assert.rejects(
      makeService(database, provider).ingest(params()),
      /simulated item persistence failure/,
    );
    assert.equal(database.orders.size, 1);
    assert.equal(database.items.size, 1);
    assert.equal([...database.orders.values()][0]?.externalOrderId, 'order-committed');
    assert.equal(database.transactionCount, 2);
  });

  it('rejects missing, inactive and non-Mercado-Livre accounts', async () => {
    const database = new InMemoryDatabase([
      makeAccount({ active: false }),
      makeAccount({ id: SECOND_ACCOUNT_ID, marketplace: Marketplace.SHOPEE }),
    ]);
    const service = makeService(database, new OrdersProviderFake([]));

    await assertIngestionError(
      service.ingest({ ...params(), marketplaceAccountId: 'missing' }),
      'ACCOUNT_NOT_FOUND',
    );
    await assertIngestionError(service.ingest(params()), 'ACCOUNT_INACTIVE');
    await assertIngestionError(
      service.ingest({ ...params(), marketplaceAccountId: SECOND_ACCOUNT_ID }),
      'UNSUPPORTED_MARKETPLACE',
    );
  });

  it('rejects invalid or non-increasing intervals before calling dependencies', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    const provider = new OrdersProviderFake([]);
    const service = makeService(database, provider);

    await assertIngestionError(
      service.ingest({ ...params(), dateFrom: new Date('invalid') }),
      'INVALID_INTERVAL',
    );
    await assertIngestionError(
      service.ingest({ ...params(), dateFrom: DATE_TO }),
      'INVALID_INTERVAL',
    );
    assert.equal(provider.calls.length, 0);
  });

  it('does not expose credentials in results', async () => {
    const database = new InMemoryDatabase([makeAccount()]);
    const provider = new OrdersProviderFake([makeOrder()]);
    provider.credentialForTest = ACCESS_TOKEN;

    const summary = await makeService(database, provider).ingest(params());

    assert.equal(JSON.stringify(summary).includes(ACCESS_TOKEN), false);
  });
});

interface StoredOrder extends Record<string, unknown> {
  id: string;
  marketplaceAccountId: string;
  externalOrderId: string;
}

interface StoredItem extends Record<string, unknown> {
  id: string;
  marketplaceOrderId: string;
  externalSellableId: string;
}

interface CatalogItem {
  marketplaceAccountId: string;
  externalListingId: string;
  externalSellableId: string;
  id: string;
  productId: string | null;
}

interface UniqueOrderArgs {
  where: {
    marketplaceAccountId_externalOrderId: {
      marketplaceAccountId: string;
      externalOrderId: string;
    };
  };
}

interface UpsertOrderArgs extends UniqueOrderArgs {
  create: Record<string, unknown> & {
    marketplaceAccountId: string;
    externalOrderId: string;
  };
  update: Record<string, unknown>;
}

interface ListingArgs {
  where: {
    marketplaceAccountId_externalListingId: {
      marketplaceAccountId: string;
      externalListingId: string;
    };
  };
  select: { items: { where: { externalSellableId: string } } };
}

interface UniqueItemArgs {
  where: {
    marketplaceOrderId_externalSellableId: {
      marketplaceOrderId: string;
      externalSellableId: string;
    };
  };
}

interface UpsertItemArgs extends UniqueItemArgs {
  create: Record<string, unknown> & {
    marketplaceOrderId: string;
    externalSellableId: string;
  };
  update: Record<string, unknown>;
}

class InMemoryDatabase {
  readonly accounts = new Map<string, MarketplaceAccount>();
  orders = new Map<string, StoredOrder>();
  items = new Map<string, StoredItem>();
  catalog = new Map<string, CatalogItem>();
  transactionCount = 0;
  failOnSellableId: string | null = null;
  private nextOrderId = 1;
  private nextItemId = 1;

  constructor(accounts: MarketplaceAccount[]) {
    for (const account of accounts) this.accounts.set(account.id, account);
  }

  get marketplaceAccount() {
    return {
      findUnique: async (args: { where: { id: string } }) =>
        this.accounts.get(args.where.id) ?? null,
    };
  }

  addCatalogItem(item: CatalogItem): void {
    this.catalog.set(catalogKey(item), item);
  }

  async $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    const working = this.cloneForTransaction();
    const result = await operation(
      working.transactionClient as unknown as Prisma.TransactionClient,
    );
    this.orders = working.orders;
    this.items = working.items;
    this.nextOrderId = working.nextOrderId;
    this.nextItemId = working.nextItemId;
    return result;
  }

  private cloneForTransaction(): InMemoryDatabase {
    const clone = new InMemoryDatabase([...this.accounts.values()]);
    clone.orders = new Map(
      [...this.orders].map(([key, value]) => [key, { ...value }]),
    );
    clone.items = new Map(
      [...this.items].map(([key, value]) => [key, { ...value }]),
    );
    clone.catalog = new Map(this.catalog);
    clone.failOnSellableId = this.failOnSellableId;
    clone.nextOrderId = this.nextOrderId;
    clone.nextItemId = this.nextItemId;
    return clone;
  }

  private readonly transactionClient = {
    marketplaceOrder: {
      findUnique: async (args: UniqueOrderArgs) => {
        const identity = args.where.marketplaceAccountId_externalOrderId;
        const order = this.orders.get(orderKey(identity));
        return order ? { id: order.id } : null;
      },
      upsert: async (args: UpsertOrderArgs) => {
        const identity = args.where.marketplaceAccountId_externalOrderId;
        const key = orderKey(identity);
        const existing = this.orders.get(key);
        const id = existing?.id ?? `order-${this.nextOrderId++}`;
        const source = existing ? args.update : args.create;
        const order: StoredOrder = normalizeMoneyFields({
          ...existing,
          ...source,
          id,
          marketplaceAccountId: identity.marketplaceAccountId,
          externalOrderId: identity.externalOrderId,
        }) as StoredOrder;
        this.orders.set(key, order);
        return { id };
      },
    },
    marketplaceListing: {
      findUnique: async (args: ListingArgs) => {
        const identity = args.where.marketplaceAccountId_externalListingId;
        const item = this.catalog.get(
          catalogKey({
            ...identity,
            externalSellableId: args.select.items.where.externalSellableId,
          }),
        );
        return item
          ? { items: [{ id: item.id, productId: item.productId }] }
          : null;
      },
    },
    marketplaceOrderItem: {
      findUnique: async (args: UniqueItemArgs) => {
        const identity = args.where.marketplaceOrderId_externalSellableId;
        const item = this.items.get(itemKey(identity));
        return item ? { id: item.id } : null;
      },
      upsert: async (args: UpsertItemArgs) => {
        const identity = args.where.marketplaceOrderId_externalSellableId;
        if (identity.externalSellableId === this.failOnSellableId) {
          throw new Error('simulated item persistence failure');
        }
        const key = itemKey(identity);
        const existing = this.items.get(key);
        const id = existing?.id ?? `item-${this.nextItemId++}`;
        const source = existing ? args.update : args.create;
        const item = normalizeMoneyFields({
          ...existing,
          ...source,
          id,
          marketplaceOrderId: identity.marketplaceOrderId,
          externalSellableId: identity.externalSellableId,
        }) as StoredItem;
        this.items.set(key, item);
        return item;
      },
    },
  };
}

class OrdersProviderFake implements MarketplaceOrdersProvider {
  readonly calls: Parameters<MarketplaceOrdersProvider['listOrders']>[0][] = [];
  credentialForTest: string | null = null;

  constructor(
    public orders: MarketplaceOrder[],
    private readonly partial = false,
  ) {}

  async listOrders(
    params: Parameters<MarketplaceOrdersProvider['listOrders']>[0],
  ) {
    this.calls.push(params);
    await Promise.resolve();
    return { orders: this.orders, partial: this.partial };
  }
}

function makeService(
  database: InMemoryDatabase,
  provider: MarketplaceOrdersProvider,
): OrdersIngestionService {
  return new OrdersIngestionService(
    database as unknown as DatabaseService,
    provider,
  );
}

function makeAccount(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: ACCOUNT_ID,
    businessAccountId: null,
    marketplace: Marketplace.MERCADO_LIVRE,
    externalAccountId: 'seller-123',
    name: 'Seller 123',
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeOrder(overrides: Partial<MarketplaceOrder> = {}): MarketplaceOrder {
  return {
    externalOrderId: 'order-123',
    rawStatus: 'paid',
    normalizedStatus: MarketplaceOrderStatus.Paid,
    soldAt: new Date('2026-09-01T12:00:00.000Z'),
    cancelledAt: null,
    currency: 'BRL',
    grossAmount: money('39.80'),
    items: [makeItem()],
    ...overrides,
  };
}

function makeItem(
  overrides: Partial<MarketplaceOrder['items'][number]> = {},
): MarketplaceOrder['items'][number] {
  return {
    externalListingId: 'MLB1000',
    externalSellableId: 'MLB1000',
    sellerSku: null,
    title: 'Produto simples',
    quantity: 2,
    unitPrice: money('19.90'),
    grossAmount: money('39.80'),
    ...overrides,
  };
}

function params() {
  return {
    marketplaceAccountId: ACCOUNT_ID,
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
  };
}

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function orderKey(identity: {
  marketplaceAccountId: string;
  externalOrderId: string;
}): string {
  return `${identity.marketplaceAccountId}|${identity.externalOrderId}`;
}

function itemKey(identity: {
  marketplaceOrderId: string;
  externalSellableId: string;
}): string {
  return `${identity.marketplaceOrderId}|${identity.externalSellableId}`;
}

function catalogKey(identity: {
  marketplaceAccountId: string;
  externalListingId: string;
  externalSellableId: string;
}): string {
  return `${identity.marketplaceAccountId}|${identity.externalListingId}|${identity.externalSellableId}`;
}

function normalizeMoneyFields(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...record };
  for (const field of ['grossAmount', 'unitPrice']) {
    if (normalized[field] instanceof Prisma.Decimal) {
      normalized[field] = normalized[field].toString();
    }
  }
  return normalized;
}

async function assertIngestionError(
  promise: Promise<unknown>,
  code: OrdersIngestionError['code'],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OrdersIngestionError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
}
