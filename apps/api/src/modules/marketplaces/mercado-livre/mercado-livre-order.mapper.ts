import {
  MarketplaceOrder,
  MarketplaceOrderStatus,
} from '../domain/marketplace-order.types.js';
import { Prisma } from '@prisma/client';
import {
  MercadoLivreOrder,
  MercadoLivreOrderItem,
} from './mercado-livre.types.js';

const STATUS_MAPPING: Readonly<Record<string, MarketplaceOrderStatus>> = {
  confirmed: MarketplaceOrderStatus.Processing,
  payment_required: MarketplaceOrderStatus.Pending,
  payment_in_process: MarketplaceOrderStatus.Pending,
  partially_paid: MarketplaceOrderStatus.Pending,
  paid: MarketplaceOrderStatus.Paid,
  partially_refunded: MarketplaceOrderStatus.PartiallyRefunded,
  pending_cancel: MarketplaceOrderStatus.Cancelled,
  cancelled: MarketplaceOrderStatus.Cancelled,
  invalid: MarketplaceOrderStatus.Unknown,
};

export function mapMercadoLivreOrderStatus(
  rawStatus: string,
): MarketplaceOrderStatus {
  return STATUS_MAPPING[rawStatus] ?? MarketplaceOrderStatus.Unknown;
}

export function mapMercadoLivreOrder(
  source: MercadoLivreOrder,
): MarketplaceOrder {
  return {
    externalOrderId: String(source.id),
    rawStatus: source.status,
    normalizedStatus: mapMercadoLivreOrderStatus(source.status),
    soldAt: parseDate(source.date_created, 'order.date_created'),
    closedAt: optionalDate(source.date_closed, 'order.date_closed'),
    lastUpdatedAt: optionalDate(
      source.date_last_updated,
      'order.date_last_updated',
    ),
    cancelledAt: source.cancel_detail?.date
      ? parseDate(source.cancel_detail.date, 'order.cancel_detail.date')
      : null,
    currency: source.currency_id,
    grossAmount: decimal(source.total_amount),
    paidAmount: optionalDecimal(source.paid_amount),
    refundedAmount: refundedAmount(source.payments),
    items: source.order_items.map((orderItem) => {
      const externalListingId = String(orderItem.item.id);
      const unitPrice = decimal(orderItem.unit_price);

      return {
        externalListingId,
        externalSellableId:
          orderItem.item.variation_id === null ||
          orderItem.item.variation_id === undefined
            ? externalListingId
            : String(orderItem.item.variation_id),
        userProductId: nullableId(orderItem.item.user_product_id),
        catalogProductId: nullableId(orderItem.item.catalog_product_id),
        sellerSku: orderItem.item.seller_sku ?? null,
        title: orderItem.item.title ?? null,
        quantity: orderItem.quantity,
        unitPrice,
        grossAmount: mapItemGrossAmount(orderItem, unitPrice),
      };
    }),
  };
}

function mapItemGrossAmount(
  orderItem: MercadoLivreOrderItem,
  unitPrice: Prisma.Decimal,
): Prisma.Decimal {
  if (orderItem.gross_price !== null && orderItem.gross_price !== undefined) {
    return decimal(orderItem.gross_price);
  }

  // Compatibilidade com payloads antigos: este valor efetivo não substitui a
  // semântica oficial de gross_price, que é o total original antes de descontos.
  return unitPrice.mul(orderItem.quantity);
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function optionalDecimal(value: number | null | undefined): Prisma.Decimal | null {
  return value === null || value === undefined ? null : decimal(value);
}

function refundedAmount(
  payments: MercadoLivreOrder['payments'],
): Prisma.Decimal | null {
  if (!payments) return null;
  return payments.reduce(
    (total, payment) =>
      total.add(optionalDecimal(payment.transaction_amount_refunded) ?? 0),
    new Prisma.Decimal(0),
  );
}

function nullableId(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function optionalDate(
  value: string | null | undefined,
  field: string,
): Date | null {
  return value ? parseDate(value, field) : null;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Mercado Livre returned an invalid ${field}.`);
  }

  return date;
}
