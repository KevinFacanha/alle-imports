import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigService } from '@nestjs/config';
import { Marketplace, Prisma } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import { MercadoLivreClient } from '../../marketplaces/mercado-livre/mercado-livre.client.js';
import { MercadoLivreOrder } from '../../marketplaces/mercado-livre/mercado-livre.types.js';
import { OlistOrdersClient } from './olist-orders.client.js';
import { OlistOrdersInspectionService } from './olist-orders-inspection.service.js';
import { OlistOrder } from './olist-orders.types.js';

const OLIST_ACCOUNT_ID = '00000000-0000-4000-8000-000000000010';
const ML_ACCOUNT_ID = '00000000-0000-4000-8000-000000000020';

describe('OlistOrdersInspectionService', () => {
  it('isolates the selected ML account, matches by ordered official identifiers and keeps Olist Full complementary', async () => {
    const olistOrders = [
      olistOrder({ id: 'olist-1', ecommerceOrderId: '100', total: '100', quantity: '2', channel: 'Mercado Livre Fulfillment' }),
      olistOrder({ id: 'olist-2', ecommerceOrderId: '999', total: '10', quantity: '1' }),
      olistOrder({ id: 'olist-3', ecommerceOrderId: '777', total: '40', quantity: '2' }),
    ];
    const mlOrders = [
      mlOrder({ id: '100', packId: '500', total: 100, quantity: 2 }),
      mlOrder({ id: '200', packId: '777', total: 20, quantity: 1 }),
      mlOrder({ id: '300', packId: '777', total: 30, quantity: 1 }),
    ];
    const database = {
      olistAccount: {
        findUnique: async () => ({ id: OLIST_ACCOUNT_ID, name: 'Olist', active: true }),
        findMany: async () => [{ id: OLIST_ACCOUNT_ID, name: 'Olist', active: true }],
      },
      marketplaceAccount: {
        findUnique: async () => ({
          id: ML_ACCOUNT_ID,
          name: 'Mercado Livre Conta 2',
          externalAccountId: 'seller-2',
          marketplace: Marketplace.MERCADO_LIVRE,
          active: true,
        }),
        findMany: async () => [
          { id: 'account-1', name: 'Mercado Livre Conta 1', externalAccountId: 'seller-1', active: true },
          { id: ML_ACCOUNT_ID, name: 'Mercado Livre Conta 2', externalAccountId: 'seller-2', active: true },
        ],
      },
    } as unknown as DatabaseService;
    const olistClient = { listOrders: async () => olistOrders } as unknown as OlistOrdersClient;
    const mercadoLivreClient = {
      searchOrders: async () => ({
        partial: false,
        data: { results: mlOrders, paging: { total: 3, offset: 0, limit: 50 } },
      }),
      getOrderShipments: async (externalOrderId: string) => [
        { id: externalOrderId, logistic_type: externalOrderId === '100' ? 'fulfillment' : 'drop_off' },
      ],
    } as unknown as MercadoLivreClient;
    const config = { get: () => 'America/Sao_Paulo' } as unknown as ConfigService<EnvironmentVariables, true>;

    const report = await new OlistOrdersInspectionService(
      database,
      olistClient,
      mercadoLivreClient,
      config,
    ).inspect({
      olistAccountId: OLIST_ACCOUNT_ID,
      marketplaceAccountId: ML_ACCOUNT_ID,
      date: '2026-09-16',
    });

    assert.equal(report.diagnostic, 'READ_ONLY');
    assert.equal(report.persistence, 'DISABLED');
    assert.equal(report.accounts.correlation.marketplaceAccount.name, 'Mercado Livre Conta 2');
    assert.equal(report.accounts.isolation.marketplaceAccountFilter, 'EXACT_ID');
    assert.equal(report.accounts.isolation.otherMarketplaceAccountsExcluded, 1);
    assert.equal(report.olist.ordersCount, 3);
    assert.equal(report.olist.itemLines, 3);
    assert.equal(report.olist.units, '5');
    assert.equal(report.olist.totalPedido, '150.00');
    assert.equal(report.olist.totalProdutos, '150.00');
    assert.deepEqual(report.olist.channelFilter.included, [
      'ML_ALEIMMPORTS 2',
      'Mercado Livre Fulfillment',
    ]);
    assert.equal(report.olist.channelFilter.excludedOrders, 0);
    assert.deepEqual(report.mercadoLivre.orderAmountByCurrency, [
      { currency: 'BRL', amount: '150.00' },
    ]);
    assert.deepEqual(report.mercadoLivre.itemGrossAmountByCurrency, [
      { currency: 'BRL', amount: '150.00' },
    ]);
    assert.equal(report.mercadoLivre.byRawStatus[0]?.status, 'paid');
    assert.equal(report.mercadoLivre.byNormalizedStatus[0]?.status, 'PAID');
    assert.equal(report.mercadoLivre.cancellations.ordersCount, 0);
    assert.equal(report.matching.matchedExact, 1);
    assert.equal(report.matching.unmatched, 1);
    assert.equal(report.matching.ambiguous, 1);
    assert.equal(report.matching.conflict, 0);
    assert.equal(report.matching.matchingRatePercent, '33.33');
    assert.equal(report.matching.byMethod['numeroPedidoEcommerce->order.id'], 1);
    assert.equal(report.matching.byMethod['numeroPedidoEcommerce->pack_id'], 1);
    assert.equal(report.matching.comparisons.length, 1);
    assert.equal(report.matching.comparisons[0]?.mlOrderId, '100');
    assert.equal(report.matching.comparisons[0]?.mlItems[0]?.listingId, 'MLB-100');
    assert.equal(report.matching.comparisons[0]?.olistItems[0]?.sku, 'SKU-olist-1');
    assert.equal(report.full.olistChannel.ordersCount, 1);
    assert.equal(report.full.officialMlClassification.ordersCount, 1);
    assert.deepEqual(
      report.full.officialMlClassification.itemGrossAmountByCurrency,
      [{ currency: 'BRL', amount: '100.00' }],
    );
    assert.equal(report.full.matchingEvidence.corroborated, 1);
    assert.equal(report.full.matchingEvidence.conflict, 0);
  });
});

function olistOrder(options: {
  id: string;
  ecommerceOrderId: string;
  total: string;
  quantity: string;
  channel?: string;
}): OlistOrder {
  const total = new Prisma.Decimal(options.total);
  return {
    olistOrderId: options.id,
    orderNumber: options.id,
    ecommerceOrderId: options.ecommerceOrderId,
    salesChannelOrderId: null,
    createdAt: '2026-09-16 12:00:00',
    date: '2026-09-16',
    statusCode: 0,
    status: 'ABERTA',
    ecommerce: 'Mercado Livre',
    salesChannel: options.channel ?? 'ML_ALEIMMPORTS 2',
    totalAmount: total,
    productTotalAmount: total,
    discountAmount: new Prisma.Decimal(0),
    freightAmount: new Prisma.Decimal(0),
    otherExpensesAmount: new Prisma.Decimal(0),
    items: [{
      sku: `SKU-${options.id}`,
      product: 'Produto seguro',
      quantity: new Prisma.Decimal(options.quantity),
      unitPrice: total.dividedBy(options.quantity),
    }],
  };
}

function mlOrder(options: {
  id: string;
  packId: string;
  total: number;
  quantity: number;
}): MercadoLivreOrder {
  return {
    id: options.id,
    pack_id: options.packId,
    status: 'paid',
    date_created: '2026-09-16T12:00:00.000Z',
    currency_id: 'BRL',
    total_amount: options.total,
    order_items: [{
      item: { id: `MLB-${options.id}`, seller_sku: `SKU-${options.id}` },
      quantity: options.quantity,
      unit_price: options.total / options.quantity,
    }],
  };
}
