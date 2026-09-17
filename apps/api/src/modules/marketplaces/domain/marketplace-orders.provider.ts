import { MarketplaceAccount } from '@prisma/client';

import { MarketplaceOrdersResult } from './marketplace-order.types.js';

export const MARKETPLACE_ORDERS_PROVIDER = Symbol(
  'MARKETPLACE_ORDERS_PROVIDER',
);

export type MarketplaceOrdersSort = 'date_asc' | 'date_desc';

export interface ListMarketplaceOrdersParams {
  marketplaceAccount: MarketplaceAccount;
  dateFrom: Date;
  dateTo: Date;
  /** Initial upstream offset. Defaults to zero. */
  offset?: number;
  /** Page size used with the upstream API. Defaults to 50. */
  limit?: number;
  sort?: MarketplaceOrdersSort;
}

export interface MarketplaceOrdersProvider {
  listOrders(
    params: ListMarketplaceOrdersParams,
  ): Promise<MarketplaceOrdersResult>;
}
