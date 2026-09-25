import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Marketplace, MarketplaceAccount, Prisma } from '@prisma/client';

import { MarketplaceOrderStatus } from '../domain/marketplace-order.types.js';
import {
  MercadoLivreClient,
  MercadoLivreClientError,
} from './mercado-livre.client.js';
import { MercadoLivreOrdersProvider } from './mercado-livre-orders.provider.js';
import {
  MercadoLivreOrder,
  MercadoLivreOrdersSearchParams,
  MercadoLivreOrdersSearchResponse,
} from './mercado-livre.types.js';

const ACCESS_TOKEN = 'test-access-token-that-must-stay-secret';
const DATE_FROM = new Date('2026-09-01T00:00:00.000Z');
const DATE_TO = new Date('2026-09-02T00:00:00.000Z');
const MARKETPLACE_ACCOUNT: MarketplaceAccount = {
  id: '00000000-0000-4000-8000-000000000001',
  businessAccountId: null,
  marketplace: Marketplace.MERCADO_LIVRE,
  externalAccountId: 'seller-123',
  name: 'Seller 123',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('MercadoLivreOrdersProvider', () => {
  it('maps an item without discount using the official gross_price', async () => {
    const order = makeOrder({
      order_items: [
        {
          ...makeOrder().order_items[0],
          gross_price: 39.8,
        },
      ],
    });
    const { provider } = makeProvider([
      jsonResponse(makeSearchResponse([order])),
    ]);

    const result = await provider.listOrders(makeListParams());

    assert.equal(result.partial, false);
    assert.equal(result.orders.length, 1);
    assert.deepEqual(result.orders[0], {
      externalOrderId: '123456789',
      rawStatus: 'paid',
      normalizedStatus: MarketplaceOrderStatus.Paid,
      soldAt: new Date('2026-09-01T12:30:00.000Z'),
      cancelledAt: null,
      currency: 'BRL',
      grossAmount: new Prisma.Decimal('39.8'),
      items: [
        {
          externalListingId: 'MLB1000',
          externalSellableId: 'MLB1000',
          sellerSku: null,
          title: 'Produto simples',
          quantity: 2,
          unitPrice: new Prisma.Decimal('19.9'),
          grossAmount: new Prisma.Decimal('39.8'),
        },
      ],
    });
  });

  it('preserves gross_price when it differs from unit_price times quantity', async () => {
    const order = makeOrder({
      order_items: [
        {
          item: {
            id: 'MLB2000',
            variation_id: 987654,
            seller_sku: 'SKU-AZUL-M',
            title: 'Camiseta azul',
          },
          quantity: 2,
          unit_price: 40,
          gross_price: 100,
        },
      ],
      total_amount: 80,
    });
    const { provider } = makeProvider([
      jsonResponse(makeSearchResponse([order])),
    ]);

    const result = await provider.listOrders(makeListParams());

    assert.deepEqual(result.orders[0]?.items[0], {
      externalListingId: 'MLB2000',
      externalSellableId: '987654',
      sellerSku: 'SKU-AZUL-M',
      title: 'Camiseta azul',
      quantity: 2,
      unitPrice: new Prisma.Decimal('40'),
      grossAmount: new Prisma.Decimal('100'),
    });
  });

  it('falls back explicitly to unit_price times quantity when gross_price is absent', async () => {
    const order = makeOrder({
      order_items: [
        {
          ...makeOrder().order_items[0],
          quantity: 3,
          unit_price: 12.34,
        },
      ],
    });
    const { provider } = makeProvider([
      jsonResponse(makeSearchResponse([order])),
    ]);

    const result = await provider.listOrders(makeListParams());

    assert.equal(result.orders[0]?.items[0]?.grossAmount.toString(), '37.02');
  });

  it('maps every documented raw order status explicitly', async () => {
    const expected = new Map<string, MarketplaceOrderStatus>([
      ['confirmed', MarketplaceOrderStatus.Processing],
      ['payment_required', MarketplaceOrderStatus.Pending],
      ['payment_in_process', MarketplaceOrderStatus.Pending],
      ['partially_paid', MarketplaceOrderStatus.Pending],
      ['paid', MarketplaceOrderStatus.Paid],
      ['partially_refunded', MarketplaceOrderStatus.PartiallyRefunded],
      ['pending_cancel', MarketplaceOrderStatus.Cancelled],
      ['cancelled', MarketplaceOrderStatus.Cancelled],
      ['invalid', MarketplaceOrderStatus.Unknown],
    ]);

    const orders = [...expected.keys()].map((status, index) =>
      makeOrder({ id: index + 1, status }),
    );
    const { provider } = makeProvider([
      jsonResponse(makeSearchResponse(orders)),
    ]);

    const result = await provider.listOrders(makeListParams());

    for (const order of result.orders) {
      assert.equal(order.normalizedStatus, expected.get(order.rawStatus));
    }
  });

  it('preserves an unknown raw status and maps it to UNKNOWN', async () => {
    const { provider } = makeProvider([
      jsonResponse(
        makeSearchResponse([makeOrder({ status: 'future_new_status' })]),
      ),
    ]);

    const result = await provider.listOrders(makeListParams());

    assert.equal(result.orders[0]?.rawStatus, 'future_new_status');
    assert.equal(
      result.orders[0]?.normalizedStatus,
      MarketplaceOrderStatus.Unknown,
    );
  });

  it('fetches every page and sends only a Bearer header credential', async () => {
    const firstOrder = makeOrder({ id: 1 });
    const secondOrder = makeOrder({ id: 2 });
    const { provider, calls } = makeProvider([
      jsonResponse(makeSearchResponse([firstOrder], 0, 1, 2)),
      jsonResponse(makeSearchResponse([secondOrder], 1, 1, 2)),
    ]);

    const result = await provider.listOrders({
      ...makeListParams(),
      limit: 1,
      sort: 'date_desc',
    });

    assert.deepEqual(
      result.orders.map((order) => order.externalOrderId),
      ['1', '2'],
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url.searchParams.get('offset'), '0');
    assert.equal(calls[1]?.url.searchParams.get('offset'), '1');
    assert.equal(calls[0]?.url.searchParams.get('limit'), '1');
    assert.equal(calls[0]?.url.searchParams.get('sort'), 'date_desc');
    assert.equal(calls[0]?.url.searchParams.get('seller'), 'seller-123');
    assert.equal(
      calls[0]?.url.searchParams.get('order.date_created.from'),
      DATE_FROM.toISOString(),
    );
    assert.equal(calls[0]?.url.toString().includes(ACCESS_TOKEN), false);
    assert.equal(
      new Headers(calls[0]?.init.headers).get('authorization'),
      `Bearer ${ACCESS_TOKEN}`,
    );
  });

  it('keeps only orders inside the requested half-open interval', async () => {
    const before = makeOrder({
      id: 1,
      date_created: '2026-08-31T23:59:59.999Z',
    });
    const atStart = makeOrder({
      id: 2,
      date_created: DATE_FROM.toISOString(),
    });
    const beforeEnd = makeOrder({
      id: 3,
      date_created: '2026-09-01T23:59:59.999Z',
    });
    const atEnd = makeOrder({
      id: 4,
      date_created: DATE_TO.toISOString(),
    });
    const { provider } = makeProvider([
      jsonResponse(
        makeSearchResponse([before, atStart, beforeEnd, atEnd]),
      ),
    ]);

    const result = await provider.listOrders(makeListParams());

    assert.deepEqual(
      result.orders.map((order) => order.externalOrderId),
      ['2', '3'],
    );
  });

  it('rejects an empty interval before calling the client', async () => {
    const { provider, calls } = makeProvider([]);

    await assert.rejects(
      provider.listOrders({
        ...makeListParams(),
        dateFrom: DATE_TO,
      }),
      /dateFrom must be before dateTo/,
    );
    assert.equal(calls.length, 0);
  });

  it('advances by the upstream page limit when a partial page omits results', async () => {
    const { provider, calls } = makeProvider([
      jsonResponse(makeSearchResponse([makeOrder({ id: 1 })], 0, 2, 3), 206),
      jsonResponse(makeSearchResponse([makeOrder({ id: 3 })], 2, 2, 3)),
    ]);

    const result = await provider.listOrders({
      ...makeListParams(),
      limit: 2,
    });

    assert.equal(calls[1]?.url.searchParams.get('offset'), '2');
    assert.equal(result.partial, true);
    assert.deepEqual(
      result.orders.map((order) => order.externalOrderId),
      ['1', '3'],
    );
  });

  it('rejects inconsistent pagination instead of looping indefinitely', async () => {
    const { provider } = makeProvider([
      jsonResponse(makeSearchResponse([makeOrder()], 1, 1, 2)),
    ]);

    await assert.rejects(
      provider.listOrders({ ...makeListParams(), limit: 1 }),
      /inconsistent pagination metadata/,
    );
  });
});

describe('MercadoLivreClient', () => {
  it('returns a sanitized authentication error for HTTP 401', async () => {
    const { client } = makeProvider([
      jsonResponse({ message: `invalid token ${ACCESS_TOKEN}` }, 401),
    ]);

    await assertClientError(
      client.searchOrders(makeSearchParams(), MARKETPLACE_ACCOUNT),
      'UNAUTHORIZED',
      401,
    );
  });

  it('returns a sanitized rate-limit error for HTTP 429', async () => {
    const { client } = makeProvider([
      jsonResponse({ message: `slow down ${ACCESS_TOKEN}` }, 429, {
        'retry-after': '30',
      }),
    ]);

    await assert.rejects(
      client.searchOrders(makeSearchParams(), MARKETPLACE_ACCOUNT),
      (error: unknown) => {
        assert.ok(error instanceof MercadoLivreClientError);
        assert.equal(error.code, 'RATE_LIMITED');
        assert.equal(error.statusCode, 429);
        assert.equal(error.retryAfter, '30');
        assert.equal(error.message.includes(ACCESS_TOKEN), false);
        return true;
      },
    );
  });

  it('accepts HTTP 206 and marks the normalized result as partial', async () => {
    const { provider } = makeProvider([
      jsonResponse(makeSearchResponse([makeOrder()]), 206),
    ]);

    const result = await provider.listOrders(makeListParams());

    assert.equal(result.partial, true);
    assert.equal(result.orders.length, 1);
  });

  it('returns a sanitized upstream error for HTTP 5xx', async () => {
    const { client } = makeProvider([
      jsonResponse({ message: `internal ${ACCESS_TOKEN}` }, 503),
    ]);

    await assertClientError(
      client.searchOrders(makeSearchParams(), MARKETPLACE_ACCOUNT),
      'UPSTREAM_UNAVAILABLE',
      503,
    );
  });
});

function makeProvider(responses: Response[]): {
  client: MercadoLivreClient;
  provider: MercadoLivreOrdersProvider;
  calls: Array<{ url: URL; init: RequestInit }>;
} {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  let responseIndex = 0;
  const fetchMock = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const response = responses[responseIndex];
    responseIndex += 1;

    if (!response) {
      throw new Error('Unexpected fetch call in test.');
    }

    return response;
  }) as typeof fetch;
  const client = new MercadoLivreClient(
    { getAccessToken: () => ACCESS_TOKEN },
    fetchMock,
    1_000,
  );

  return {
    client,
    provider: new MercadoLivreOrdersProvider(client),
    calls,
  };
}

function makeListParams() {
  return {
    marketplaceAccount: MARKETPLACE_ACCOUNT,
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
  };
}

function makeSearchParams(): MercadoLivreOrdersSearchParams {
  return {
    seller: 'seller-123',
    dateCreatedFrom: DATE_FROM.toISOString(),
    dateCreatedTo: DATE_TO.toISOString(),
    offset: 0,
    limit: 50,
    sort: 'date_asc',
  };
}

function makeOrder(overrides: Partial<MercadoLivreOrder> = {}): MercadoLivreOrder {
  return {
    id: 123456789,
    status: 'paid',
    date_created: '2026-09-01T12:30:00.000Z',
    currency_id: 'BRL',
    total_amount: 39.8,
    order_items: [
      {
        item: {
          id: 'MLB1000',
          variation_id: null,
          seller_sku: null,
          title: 'Produto simples',
        },
        quantity: 2,
        unit_price: 19.9,
      },
    ],
    ...overrides,
  };
}

function makeSearchResponse(
  results: MercadoLivreOrder[],
  offset = 0,
  limit = 50,
  total = results.length,
): MercadoLivreOrdersSearchResponse {
  return {
    results,
    paging: { total, offset, limit },
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

async function assertClientError(
  operation: Promise<unknown>,
  code: MercadoLivreClientError['code'],
  statusCode: number,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof MercadoLivreClientError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
}
