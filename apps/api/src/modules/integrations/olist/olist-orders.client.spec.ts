import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Prisma } from '@prisma/client';

import { OlistAuthorizationService } from './olist-authorization.service.js';
import {
  OlistOrdersClient,
  OlistOrdersClientError,
} from './olist-orders.client.js';

const ACCESS_TOKEN = 'olist-secret-token-never-log-this';
const ACCOUNT = { id: '00000000-0000-4000-8000-000000000010' };

describe('OlistOrdersClient', () => {
  it('authenticates GET requests, paginates, maps external IDs, statuses, multiple items and Decimal values without PII', async () => {
    const responses = [
      jsonResponse(listResponse([summary(10)], 0, 1, 2)),
      jsonResponse(listResponse([summary(20)], 1, 1, 2)),
      jsonResponse(
        detail(10, {
          valorTotalPedido: 59.9,
          valorTotalProdutos: 59.9,
          valorDesconto: '3.10',
          valorFrete: 7,
          valorOutrasDespesas: '1.25',
          cliente: {
            nome: 'Pessoa Sigilosa',
            cpfCnpj: '111.222.333-44',
            telefone: '51999999999',
          },
          enderecoEntrega: { endereco: 'Rua Privada, 123' },
          itens: [
            {
              produto: { sku: 'SKU-A', descricao: 'Produto A' },
              quantidade: 2,
              valorUnitario: 19.95,
            },
            {
              produto: { sku: 'SKU-B', descricao: 'Produto B' },
              quantidade: 1,
              valorUnitario: '20.00',
            },
          ],
        }),
      ),
      jsonResponse(detail(20, { situacao: 2 })),
    ];
    const { client, calls } = makeClient(responses);

    const orders = await client.listOrders({
      account: ACCOUNT,
      date: '2026-09-16',
      timeZone: 'America/Sao_Paulo',
      limit: 1,
    });

    assert.equal(orders.length, 2);
    assert.equal(orders[0]?.olistOrderId, '10');
    assert.equal(orders[0]?.orderNumber, '5010');
    assert.equal(orders[0]?.ecommerceOrderId, 'ML-ECOM-10');
    assert.equal(orders[0]?.salesChannelOrderId, 'ML-CHANNEL-10');
    assert.equal(orders[0]?.ecommerce, 'Mercado Livre');
    assert.equal(orders[0]?.salesChannel, 'Mercado Livre');
    assert.equal(orders[0]?.status, 'APROVADA');
    assert.ok(orders[0]?.totalAmount instanceof Prisma.Decimal);
    assert.equal(orders[0]?.totalAmount.toFixed(2), '59.90');
    assert.equal(orders[0]?.productTotalAmount?.toFixed(2), '59.90');
    assert.equal(orders[0]?.discountAmount.toFixed(2), '3.10');
    assert.equal(orders[0]?.freightAmount.toFixed(2), '7.00');
    assert.equal(orders[0]?.otherExpensesAmount?.toFixed(2), '1.25');
    assert.equal(orders[0]?.items.length, 2);
    assert.equal(orders[0]?.items[0]?.quantity.toString(), '2');
    assert.equal(orders[0]?.items[0]?.unitPrice.toFixed(2), '19.95');
    assert.equal(orders[1]?.status, 'CANCELADA');

    assert.deepEqual(
      calls.slice(0, 2).map((call) => call.url.searchParams.get('offset')),
      ['0', '1'],
    );
    assert.equal(calls[0]?.url.searchParams.get('dataInicial'), '2026-09-16');
    assert.equal(calls[0]?.url.searchParams.get('dataFinal'), '2026-09-16');
    assert.equal(calls[0]?.url.searchParams.get('limit'), '1');
    assert.ok(calls.every((call) => call.init.method === 'GET'));
    assert.ok(calls.every((call) => !call.url.toString().includes(ACCESS_TOKEN)));
    assert.ok(
      calls.every(
        (call) =>
          new Headers(call.init.headers).get('authorization') ===
          `Bearer ${ACCESS_TOKEN}`,
      ),
    );
    const serialized = JSON.stringify(orders);
    for (const forbidden of [
      'Pessoa Sigilosa',
      '111.222.333-44',
      '51999999999',
      'Rua Privada',
      'cliente',
      'cpfCnpj',
      'enderecoEntrega',
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it('enforces the requested half-open local day when Olist returns offset timestamps', async () => {
    const responses = [
      jsonResponse(
        listResponse(
          [
            summary(10, { dataCriacao: '2026-09-17T02:59:59.999Z' }),
            summary(20, { dataCriacao: '2026-09-17T03:00:00.000Z' }),
          ],
          0,
          100,
          2,
        ),
      ),
      jsonResponse(detail(10)),
    ];
    const { client, calls } = makeClient(responses);

    const orders = await client.listOrders({
      account: ACCOUNT,
      date: '2026-09-16',
      timeZone: 'America/Sao_Paulo',
    });

    assert.deepEqual(orders.map((order) => order.olistOrderId), ['10']);
    assert.equal(calls.length, 2);
  });

  it('returns sanitized external errors without response bodies or credentials', async () => {
    const { client } = makeClient([
      jsonResponse({ message: `invalid ${ACCESS_TOKEN}`, cpf: 'secret' }, 401),
    ]);

    await assert.rejects(
      client.listOrders({
        account: ACCOUNT,
        date: '2026-09-16',
        timeZone: 'America/Sao_Paulo',
      }),
      (error: unknown) => {
        assert.ok(error instanceof OlistOrdersClientError);
        assert.equal(error.code, 'UNAUTHORIZED');
        assert.equal(error.statusCode, 401);
        assert.equal(error.message.includes(ACCESS_TOKEN), false);
        assert.equal(JSON.stringify(error).includes(ACCESS_TOKEN), false);
        assert.equal(JSON.stringify(error).includes('secret'), false);
        return true;
      },
    );
  });
});

function makeClient(responses: Response[]) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  let index = 0;
  const fetchMock = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error('Unexpected fetch request.');
    }
    return response;
  }) as typeof fetch;
  const authorization = {
    getAccessToken: async () => ACCESS_TOKEN,
  } as unknown as OlistAuthorizationService;
  return {
    client: new OlistOrdersClient(authorization, fetchMock, 1_000, 0),
    calls,
  };
}

function summary(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    numeroPedido: 5000 + id,
    situacao: 3,
    dataCriacao: '2026-09-16 12:00:00',
    ecommerce: {
      id: 1,
      nome: 'Mercado Livre',
      numeroPedidoEcommerce: `ML-ECOM-${id}`,
      numeroPedidoCanalVenda: `ML-CHANNEL-${id}`,
      canalVenda: 'Mercado Livre',
    },
    cliente: { nome: 'Must not be mapped' },
    ...overrides,
  };
}

function detail(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    numeroPedido: 5000 + id,
    situacao: 3,
    data: '2026-09-16',
    valorTotalPedido: 10,
    valorDesconto: 0,
    valorFrete: 0,
    ecommerce: {
      nome: 'Mercado Livre',
      numeroPedidoEcommerce: `ML-ECOM-${id}`,
      numeroPedidoCanalVenda: `ML-CHANNEL-${id}`,
      canalVenda: 'Mercado Livre',
    },
    itens: [
      {
        produto: { sku: `SKU-${id}`, descricao: `Produto ${id}` },
        quantidade: 1,
        valorUnitario: 10,
      },
    ],
    ...overrides,
  };
}

function listResponse(
  itens: unknown[],
  offset: number,
  limit: number,
  total: number,
) {
  return { itens, paginacao: { offset, limit, total } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
