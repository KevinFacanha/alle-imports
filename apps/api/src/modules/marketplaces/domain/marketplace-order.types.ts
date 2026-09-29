import { Prisma } from '@prisma/client';

export enum MarketplaceOrderStatus {
  Pending = 'PENDING',
  Paid = 'PAID',
  Processing = 'PROCESSING',
  Shipped = 'SHIPPED',
  Delivered = 'DELIVERED',
  Cancelled = 'CANCELLED',
  PartiallyRefunded = 'PARTIALLY_REFUNDED',
  Refunded = 'REFUNDED',
  Unknown = 'UNKNOWN',
}

export interface MarketplaceOrderItem {
  externalListingId: string;
  externalSellableId: string;
  userProductId: string | null;
  catalogProductId: string | null;
  sellerSku: string | null;
  title: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal;
  /**
   * Total bruto do item antes de descontos. Quando a origem não o informa,
   * contém o fallback explícito de unitPrice × quantity.
   */
  grossAmount: Prisma.Decimal;
}

export interface MarketplaceOrder {
  externalOrderId: string;
  rawStatus: string;
  normalizedStatus: MarketplaceOrderStatus;
  soldAt: Date;
  closedAt: Date | null;
  lastUpdatedAt: Date | null;
  cancelledAt: Date | null;
  currency: string;
  /** Valor total da order informado pelo marketplace. */
  grossAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal | null;
  refundedAmount: Prisma.Decimal | null;
  items: MarketplaceOrderItem[];
}

export interface MarketplaceOrdersResult {
  orders: MarketplaceOrder[];
  /** True when at least one upstream page was returned as HTTP 206. */
  partial: boolean;
}

export interface MarketplaceOrdersPage extends MarketplaceOrdersResult {
  offset: number;
  nextOffset: number | null;
  total: number;
  hasMore: boolean;
}
