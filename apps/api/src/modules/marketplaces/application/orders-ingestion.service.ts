import { Inject, Injectable } from '@nestjs/common';
import {
  Marketplace,
  MarketplaceOrderStatus as PrismaMarketplaceOrderStatus,
  Prisma,
} from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import { MarketplaceOrder } from '../domain/marketplace-order.types.js';
import {
  MARKETPLACE_ORDERS_PROVIDER,
  MarketplaceOrdersProvider,
} from '../domain/marketplace-orders.provider.js';

export interface IngestOrdersParams {
  marketplaceAccountId: string;
  dateFrom: Date;
  dateTo: Date;
}

export interface OrdersIngestionSummary {
  marketplaceAccountId: string;
  dateFrom: string;
  dateTo: string;
  fetched: number;
  created: number;
  updated: number;
  itemsCreated: number;
  itemsUpdated: number;
  unmappedItems: number;
  partial: boolean;
}

export type OrdersIngestionErrorCode =
  | 'INVALID_INTERVAL'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'UNSUPPORTED_MARKETPLACE';

export class OrdersIngestionError extends Error {
  constructor(
    readonly code: OrdersIngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OrdersIngestionError';
  }
}

interface PersistenceCounts {
  created: number;
  updated: number;
  itemsCreated: number;
  itemsUpdated: number;
  unmappedItems: number;
}

@Injectable()
export class OrdersIngestionService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(MARKETPLACE_ORDERS_PROVIDER)
    private readonly ordersProvider: MarketplaceOrdersProvider,
  ) {}

  async ingest(params: IngestOrdersParams): Promise<OrdersIngestionSummary> {
    validateInterval(params.dateFrom, params.dateTo);

    const marketplaceAccount = await this.database.marketplaceAccount.findUnique({
      where: { id: params.marketplaceAccountId },
    });

    if (!marketplaceAccount) {
      throw new OrdersIngestionError(
        'ACCOUNT_NOT_FOUND',
        'Marketplace account was not found.',
      );
    }
    if (!marketplaceAccount.active) {
      throw new OrdersIngestionError(
        'ACCOUNT_INACTIVE',
        'Marketplace account is inactive.',
      );
    }
    if (marketplaceAccount.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new OrdersIngestionError(
        'UNSUPPORTED_MARKETPLACE',
        'Marketplace account is not a Mercado Livre account.',
      );
    }

    const result = await this.ordersProvider.listOrders({
      marketplaceAccount,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    const totals: PersistenceCounts = {
      created: 0,
      updated: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      unmappedItems: 0,
    };

    for (const order of result.orders) {
      const counts = await this.database.$transaction((transaction) =>
        persistOrder(
          transaction,
          marketplaceAccount.id,
          order,
        ),
      );
      addCounts(totals, counts);
    }

    return {
      marketplaceAccountId: marketplaceAccount.id,
      dateFrom: params.dateFrom.toISOString(),
      dateTo: params.dateTo.toISOString(),
      fetched: result.orders.length,
      ...totals,
      partial: result.partial,
    };
  }
}

async function persistOrder(
  transaction: Prisma.TransactionClient,
  marketplaceAccountId: string,
  order: MarketplaceOrder,
): Promise<PersistenceCounts> {
  const orderIdentity = {
    marketplaceAccountId_externalOrderId: {
      marketplaceAccountId,
      externalOrderId: order.externalOrderId,
    },
  };
  const existingOrder = await transaction.marketplaceOrder.findUnique({
    where: orderIdentity,
    select: { id: true },
  });
  const orderData = {
    normalizedStatus:
      order.normalizedStatus as PrismaMarketplaceOrderStatus,
    rawStatus: order.rawStatus,
    soldAt: order.soldAt,
    cancelledAt: order.cancelledAt,
    currency: order.currency,
    grossAmount: order.grossAmount,
  };
  const persistedOrder = await transaction.marketplaceOrder.upsert({
    where: orderIdentity,
    create: {
      marketplaceAccountId,
      externalOrderId: order.externalOrderId,
      ...orderData,
    },
    update: orderData,
    select: { id: true },
  });
  const counts: PersistenceCounts = {
    created: existingOrder ? 0 : 1,
    updated: existingOrder ? 1 : 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    unmappedItems: 0,
  };

  for (const item of order.items) {
    const listing = await transaction.marketplaceListing.findUnique({
      where: {
        marketplaceAccountId_externalListingId: {
          marketplaceAccountId,
          externalListingId: item.externalListingId,
        },
      },
      select: {
        items: {
          where: { externalSellableId: item.externalSellableId },
          take: 1,
          select: { id: true, productId: true },
        },
      },
    });
    const mappedListingItem = listing?.items[0] ?? null;
    const itemIdentity = {
      marketplaceOrderId_externalSellableId: {
        marketplaceOrderId: persistedOrder.id,
        externalSellableId: item.externalSellableId,
      },
    };
    const existingItem = await transaction.marketplaceOrderItem.findUnique({
      where: itemIdentity,
      select: { id: true },
    });
    const itemData = {
      externalListingId: item.externalListingId,
      sellerSku: item.sellerSku,
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      grossAmount: item.grossAmount,
      marketplaceListingItemId: mappedListingItem?.id ?? null,
      productId: mappedListingItem?.productId ?? null,
    };

    await transaction.marketplaceOrderItem.upsert({
      where: itemIdentity,
      create: {
        marketplaceOrderId: persistedOrder.id,
        externalSellableId: item.externalSellableId,
        ...itemData,
      },
      update: itemData,
    });

    counts.itemsCreated += existingItem ? 0 : 1;
    counts.itemsUpdated += existingItem ? 1 : 0;
    counts.unmappedItems += mappedListingItem ? 0 : 1;
  }

  return counts;
}

function validateInterval(dateFrom: Date, dateTo: Date): void {
  if (
    Number.isNaN(dateFrom.getTime()) ||
    Number.isNaN(dateTo.getTime()) ||
    dateFrom >= dateTo
  ) {
    throw new OrdersIngestionError(
      'INVALID_INTERVAL',
      'dateFrom and dateTo must be valid dates and dateFrom must be before dateTo.',
    );
  }
}

function addCounts(target: PersistenceCounts, source: PersistenceCounts): void {
  target.created += source.created;
  target.updated += source.updated;
  target.itemsCreated += source.itemsCreated;
  target.itemsUpdated += source.itemsUpdated;
  target.unmappedItems += source.unmappedItems;
}
