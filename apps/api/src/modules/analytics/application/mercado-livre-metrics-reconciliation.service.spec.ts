import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigService } from '@nestjs/config';
import { Marketplace, MarketplaceOrderStatus, Prisma } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  MercadoLivreClient,
  MercadoLivreClientError,
} from '../../marketplaces/mercado-livre/mercado-livre.client.js';
import {
  MercadoLivreMetricsReconciliationService,
  ReconciliationRow,
} from './mercado-livre-metrics-reconciliation.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const ACCESS_TOKEN = 'credential-that-must-never-appear-in-output';

describe('MercadoLivreMetricsReconciliationService', () => {
  it('reconciles visits, raw statuses, fulfillment and multi-item quantities with account isolation', async () => {
    const database = new ReconciliationDatabaseFake([
      storedOrder({
        externalOrderId: 'full-order',
        rawStatus: 'paid',
        normalizedStatus: MarketplaceOrderStatus.PAID,
        grossAmount: '100.00',
        items: [
          { quantity: 2, grossAmount: '60.00' },
          { quantity: 1, grossAmount: '40.00' },
        ],
      }),
      storedOrder({
        externalOrderId: 'drop-off-order',
        rawStatus: 'cancelled',
        normalizedStatus: MarketplaceOrderStatus.CANCELLED,
        grossAmount: '50.00',
        items: [{ quantity: 4, grossAmount: '50.00' }],
      }),
      storedOrder({
        externalOrderId: 'without-shipment',
        rawStatus: null,
        normalizedStatus: MarketplaceOrderStatus.UNKNOWN,
        grossAmount: '25.00',
        items: [{ quantity: 1, grossAmount: '25.00' }],
      }),
      storedOrder({
        marketplaceAccountId: SECOND_ACCOUNT_ID,
        externalOrderId: 'other-account',
        grossAmount: '9999.00',
        items: [{ quantity: 99, grossAmount: '9999.00' }],
      }),
    ]);
    const client = new MercadoLivreClientFake(1700, {
      'full-order': [{ id: 10, logistic_type: 'fulfillment' }],
      'drop-off-order': [{ id: 20, logistic_type: 'drop_off' }],
      'without-shipment': [],
    });

    const report = await makeService(database, client).reconcile({
      marketplaceAccountId: ACCOUNT_ID,
      date: '2026-09-16',
    });

    assert.equal(report.diagnostic, 'READ_ONLY');
    assert.deepEqual(report.classification, {
      ordersAndShipments: 'OPERATIONAL_ORDERS_METRICS',
      biReference: 'SELLER_BI_METRICS',
    });
    assert.deepEqual(report.conclusion, {
      marketplaceOrderIsDirectSpreadsheetSource: false,
      dailySalesSummaryIsDirectSpreadsheetSource: false,
      operationalLayerPurpose: 'AUDIT_AND_OPERATIONAL_DATA',
    });
    assert.equal(report.orders.semantics, 'OPERATIONAL_ORDERS_METRICS');
    assert.equal(report.orders.minimumSoldAt, '2026-09-16T12:00:00.000Z');
    assert.equal(report.orders.maximumSoldAt, '2026-09-16T12:00:00.000Z');
    assert.equal(report.orders.totalOrders, 3);
    assert.equal(report.orders.totalItems, 4);
    assert.equal(report.orders.totalUnits, 8);
    assert.deepEqual(report.orders.grossAmountByCurrency, [
      { currency: 'BRL', amount: '175.00' },
    ]);
    assert.deepEqual(
      report.orders.byNormalizedStatus.map((row) => [
        row.status,
        row.orders,
        row.units,
      ]),
      [
        ['CANCELLED', 1, 4],
        ['PAID', 1, 3],
        ['UNKNOWN', 1, 1],
      ],
    );
    assert.deepEqual(
      report.orders.byRawStatus.map((row) => [row.status, row.orders]),
      [
        ['(null)', 1],
        ['cancelled', 1],
        ['paid', 1],
      ],
    );
    assert.deepEqual(report.orders.cancelled, [
      {
        externalOrderId: 'drop-off-order',
        normalizedStatus: 'CANCELLED',
        rawStatus: 'cancelled',
        soldAt: '2026-09-16T12:00:00.000Z',
      },
    ]);
    assert.equal(report.visits.totalVisits, 1700);
    assert.equal(report.visits.requestedDateFrom, '2026-09-16');
    assert.equal(report.visits.requestedDateTo, '2026-09-17');
    assert.equal(report.full.fullOrders, 1);
    assert.equal(report.full.semantics, 'OPERATIONAL_ORDERS_METRICS');
    assert.equal(report.full.nonFullOrders, 2);
    assert.equal(report.full.ordersWithoutShipment, 1);
    assert.equal(report.full.fullUnits, 3);
    assert.deepEqual(report.full.fullGrossAmountByCurrency, [
      { currency: 'BRL', amount: '100.00' },
    ]);

    assert.deepEqual(report.reference, {
      source: 'MANUAL_GABI_BI',
      semantics: 'SELLER_METRICS',
      date: '2026-09-16',
      marketplace: 'MERCADO LIVRE',
      grossRevenueDay: '10882.00',
      salesQuantity: 118,
      unitsSold: 130,
      fullGrossSales: '590.00',
      fullUnitsSold: 14,
      fullSalesQuantity: 9,
      averageTicket: '92.22',
      contributionMarginPercent: '25.68',
      definitions: {
        fullGrossSales: 'Vendas brutas com filtro Mercado Envios Full',
        fullUnitsSold: 'Unidades vendidas com filtro Mercado Envios Full',
        fullSalesQuantity: 'Quantidade de vendas com filtro Mercado Envios Full',
      },
    });

    const visits = findMetric(report.comparison, 'operational.visits');
    assert.deepEqual(visits, {
      metric: 'operational.visits',
      calculated: 1700,
      reference: null,
      difference: null,
      status: 'OPERATIONAL_DIAGNOSTIC',
      explanation:
        'Visitas retornadas pelo endpoint oficial; diagnóstico operacional.',
    });
    const salesCount = findMetric(report.comparison, 'operational.orders.count');
    assert.equal(salesCount.calculated, 3);
    assert.equal(salesCount.reference, null);
    assert.equal(salesCount.difference, null);
    assert.equal(salesCount.status, 'OPERATIONAL_DIAGNOSTIC');
    const operationalFullGross = findMetric(
      report.comparison,
      'operational.fulfillment.gross_amount',
    );
    assert.equal(operationalFullGross.calculated, '100.00');
    assert.equal(operationalFullGross.reference, null);
    const sellerBiFull = findMetric(report.comparison, 'seller_bi.full');
    assert.equal(sellerBiFull.calculated, null);
    assert.equal(sellerBiFull.reference, '590.00');
    assert.equal(sellerBiFull.status, 'SELLER_BI_REFERENCE');
    const sellerBiFullUnits = findMetric(
      report.comparison,
      'seller_bi.qtde_vendas_full',
    );
    assert.equal(sellerBiFullUnits.calculated, null);
    assert.equal(sellerBiFullUnits.reference, 14);
    assert.equal(
      report.orderCountInvestigation.conclusion,
      'NOT_COMPARABLE_DIFFERENT_SEMANTICS',
    );
    assert.equal(report.orderCountInvestigation.difference, null);

    assert.deepEqual(database.queriedAccountIds, [ACCOUNT_ID]);
    assert.ok(client.calls.every((call) => call.accountId === ACCOUNT_ID));
    assert.equal(JSON.stringify(report).includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(client.calls).includes(ACCESS_TOKEN), false);
  });

  it('keeps operational diagnostics separate when there is no Seller BI reference', async () => {
    const database = new ReconciliationDatabaseFake([]);
    const client = new MercadoLivreClientFake(0, {});

    const report = await makeService(database, client).reconcile({
      marketplaceAccountId: ACCOUNT_ID,
      date: '2026-09-15',
    });

    assert.equal(report.reference, null);
    assert.equal(
      findMetric(report.comparison, 'operational.visits').status,
      'OPERATIONAL_DIAGNOSTIC',
    );
    assert.equal(
      findMetric(report.comparison, 'seller_bi.ticket_medio').status,
      'NO_REFERENCE',
    );
  });

  it('keeps the read-only report available when official resources return sanitized errors', async () => {
    const database = new ReconciliationDatabaseFake([storedOrder()]);
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const client = makeHttpClient(
      [
        jsonResponse(
          {
            code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
            blocked_by: 'PolicyAgent',
            message: `must not leak ${ACCESS_TOKEN}`,
          },
          403,
        ),
        jsonResponse({}, 403),
      ],
      calls,
    );

    const report = await makeService(database, client).reconcile({
      marketplaceAccountId: ACCOUNT_ID,
      date: '2026-09-16',
    });

    assert.deepEqual(report.visits.api, {
      status: 'UNAVAILABLE',
      errorCode: 'ACCESS_DENIED',
      httpStatus: 403,
      upstreamCode: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
      blockedBy: 'PolicyAgent',
      message: 'Mercado Livre denied access to the visits resource.',
    });
    assert.equal(report.visits.totalVisits, null);
    assert.deepEqual(report.full.api, {
      status: 'UNAVAILABLE',
      errorCode: 'ACCESS_DENIED',
      httpStatus: 403,
      message:
        'Mercado Livre denied access to the order shipments resource.',
    });
    assert.equal(report.full.fullOrders, null);
    assert.equal(
      findMetric(report.comparison, 'operational.fulfillment.orders').status,
      'OPERATIONAL_DIAGNOSTIC',
    );
    assert.equal(JSON.stringify(report).includes(ACCESS_TOKEN), false);
    assert.equal(calls.length, 2);
  });
});

describe('MercadoLivreClient metrics resources', () => {
  it('uses only the documented visits and order shipments endpoints with OAuth Bearer auth', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const responses = [
      jsonResponse({
        user_id: 123,
        date_from: '2026-09-16T00:00:00Z',
        date_to: '2026-09-17T00:00:00Z',
        total_visits: 1739,
        visits_detail: [{ company: 'mercadolivre', quantity: 1739 }],
      }),
      jsonResponse({ id: 456, logistic_type: 'fulfillment' }),
    ];
    const client = makeHttpClient(responses, calls);
    const account = { id: ACCOUNT_ID };

    const visits = await client.getUserVisits(
      '123',
      '2026-09-16',
      '2026-09-17',
      account,
    );
    const shipments = await client.getOrderShipments('789', account);

    assert.equal(visits.total_visits, 1739);
    assert.equal(shipments[0]?.logistic_type, 'fulfillment');
    assert.equal(calls[0]?.url.pathname, '/users/123/items_visits');
    assert.equal(calls[0]?.url.searchParams.get('date_from'), '2026-09-16');
    assert.equal(calls[0]?.url.searchParams.get('date_to'), '2026-09-17');
    assert.equal(calls[1]?.url.pathname, '/orders/789/shipments');
    assert.equal(
      new Headers(calls[1]?.init.headers).get('x-new-domain'),
      'true',
    );
    for (const call of calls) {
      assert.equal(call.url.toString().includes(ACCESS_TOKEN), false);
      assert.equal(
        new Headers(call.init.headers).get('authorization'),
        `Bearer ${ACCESS_TOKEN}`,
      );
    }
  });

  it('keeps upstream response bodies and credentials out of errors', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const client = makeHttpClient(
      [jsonResponse({ message: `invalid ${ACCESS_TOKEN}` }, 401)],
      calls,
    );

    await assert.rejects(
      client.getUserVisits('123', '2026-09-16', '2026-09-17', {
        id: ACCOUNT_ID,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MercadoLivreClientError);
        assert.equal(error.code, 'UNAUTHORIZED');
        assert.equal(JSON.stringify(error).includes(ACCESS_TOKEN), false);
        assert.equal(error.message.includes(ACCESS_TOKEN), false);
        return true;
      },
    );
  });

  it('keeps only allowlisted 403 diagnostics and never exposes the upstream message', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const client = makeHttpClient(
      [
        jsonResponse(
          {
            code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
            blocked_by: 'PolicyAgent',
            message: `sensitive ${ACCESS_TOKEN}`,
          },
          403,
        ),
      ],
      calls,
    );

    await assert.rejects(
      client.getUserVisits('123', '2026-09-16', '2026-09-17', {
        id: ACCOUNT_ID,
      }),
      (error: unknown) => {
        assert.ok(error instanceof MercadoLivreClientError);
        assert.equal(error.code, 'ACCESS_DENIED');
        assert.equal(error.statusCode, 403);
        assert.equal(
          error.upstreamCode,
          'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
        );
        assert.equal(error.blockedBy, 'PolicyAgent');
        assert.equal(JSON.stringify(error).includes(ACCESS_TOKEN), false);
        assert.equal(error.message.includes(ACCESS_TOKEN), false);
        return true;
      },
    );
  });
});

interface StoredOrder {
  marketplaceAccountId: string;
  externalOrderId: string;
  soldAt: Date;
  normalizedStatus: MarketplaceOrderStatus;
  rawStatus: string | null;
  currency: string;
  grossAmount: Prisma.Decimal;
  items: Array<{ quantity: number; grossAmount: Prisma.Decimal }>;
}

class ReconciliationDatabaseFake {
  readonly queriedAccountIds: string[] = [];

  constructor(private readonly orders: StoredOrder[]) {}

  readonly marketplaceAccount = {
    findUnique: async (args: { where: { id: string } }) =>
      [ACCOUNT_ID, SECOND_ACCOUNT_ID].includes(args.where.id)
        ? {
            id: args.where.id,
            externalAccountId:
              args.where.id === ACCOUNT_ID ? 'seller-123' : 'seller-456',
            marketplace: Marketplace.MERCADO_LIVRE,
            active: true,
          }
        : null,
  };

  readonly marketplaceOrder = {
    findMany: async (args: {
      where: {
        marketplaceAccountId: string;
        soldAt: { gte: Date; lt: Date };
      };
    }) => {
      this.queriedAccountIds.push(args.where.marketplaceAccountId);
      return this.orders.filter(
        (order) =>
          order.marketplaceAccountId === args.where.marketplaceAccountId &&
          order.soldAt >= args.where.soldAt.gte &&
          order.soldAt < args.where.soldAt.lt,
      );
    },
  };
}

class MercadoLivreClientFake {
  readonly calls: Array<{
    resource: 'visits' | 'shipments';
    accountId: string;
    externalId: string;
  }> = [];

  constructor(
    private readonly totalVisits: number,
    private readonly shipments: Record<
      string,
      Array<{ id: number; logistic_type: string }>
    >,
  ) {}

  async getUserVisits(
    userId: string,
    dateFrom: string,
    dateTo: string,
    account: { id: string },
  ) {
    this.calls.push({
      resource: 'visits',
      accountId: account.id,
      externalId: userId,
    });
    return {
      user_id: userId,
      date_from: dateFrom,
      date_to: dateTo,
      total_visits: this.totalVisits,
    };
  }

  async getOrderShipments(
    externalOrderId: string,
    account: { id: string },
  ) {
    this.calls.push({
      resource: 'shipments',
      accountId: account.id,
      externalId: externalOrderId,
    });
    return this.shipments[externalOrderId] ?? [];
  }
}

function storedOrder(
  overrides: Partial<{
    marketplaceAccountId: string;
    externalOrderId: string;
    soldAt: string;
    normalizedStatus: MarketplaceOrderStatus;
    rawStatus: string | null;
    currency: string;
    grossAmount: string;
    items: Array<{ quantity: number; grossAmount: string }>;
  }> = {},
): StoredOrder {
  return {
    marketplaceAccountId: overrides.marketplaceAccountId ?? ACCOUNT_ID,
    externalOrderId: overrides.externalOrderId ?? 'order-1',
    soldAt: new Date(overrides.soldAt ?? '2026-09-16T12:00:00.000Z'),
    normalizedStatus:
      overrides.normalizedStatus ?? MarketplaceOrderStatus.PAID,
    rawStatus: overrides.rawStatus === undefined ? 'paid' : overrides.rawStatus,
    currency: overrides.currency ?? 'BRL',
    grossAmount: new Prisma.Decimal(overrides.grossAmount ?? '10.00'),
    items: (overrides.items ?? [{ quantity: 1, grossAmount: '10.00' }]).map(
      (item) => ({
        quantity: item.quantity,
        grossAmount: new Prisma.Decimal(item.grossAmount),
      }),
    ),
  };
}

function makeService(
  database: ReconciliationDatabaseFake,
  client: MercadoLivreClientFake | MercadoLivreClient,
): MercadoLivreMetricsReconciliationService {
  const config = {
    get: () => 'America/Sao_Paulo',
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new MercadoLivreMetricsReconciliationService(
    database as unknown as DatabaseService,
    client as unknown as MercadoLivreClient,
    config,
  );
}

function findMetric(
  rows: ReconciliationRow[],
  metric: string,
): ReconciliationRow {
  const row = rows.find((candidate) => candidate.metric === metric);
  assert.ok(row, `Missing comparison metric ${metric}`);
  return row;
}

function makeHttpClient(
  responses: Response[],
  calls: Array<{ url: URL; init: RequestInit }>,
): MercadoLivreClient {
  let responseIndex = 0;
  const fetchMock = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const response = responses[responseIndex];
    responseIndex += 1;
    if (!response) {
      throw new Error('Unexpected fetch call.');
    }
    return response;
  }) as typeof fetch;
  return new MercadoLivreClient(
    { getAccessToken: () => ACCESS_TOKEN },
    fetchMock,
    1_000,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
