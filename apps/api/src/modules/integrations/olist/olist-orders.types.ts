import { Prisma } from '@prisma/client';

export interface OlistOrderItem {
  sku: string | null;
  product: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
}

export interface OlistOrder {
  olistOrderId: string;
  orderNumber: string | null;
  ecommerceOrderId: string | null;
  salesChannelOrderId: string | null;
  createdAt: string | null;
  date: string | null;
  statusCode: number | null;
  status: string;
  ecommerce: string | null;
  salesChannel: string | null;
  totalAmount: Prisma.Decimal;
  /** Valor total de produtos informado diretamente pela Olist, quando presente. */
  productTotalAmount: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  /** Outras despesas informadas diretamente pela Olist, quando presentes. */
  otherExpensesAmount: Prisma.Decimal | null;
  items: OlistOrderItem[];
}

export interface OlistOrderListParams {
  account: { id: string };
  date: string;
  timeZone: string;
  limit?: number;
}
