import { Injectable } from '@nestjs/common';

import {
  ListMarketplaceOrdersParams,
  MarketplaceOrdersProvider,
} from '../domain/marketplace-orders.provider.js';
import {
  MarketplaceOrder,
  MarketplaceOrdersResult,
} from '../domain/marketplace-order.types.js';
import { MercadoLivreClient } from './mercado-livre.client.js';
import { mapMercadoLivreOrder } from './mercado-livre-order.mapper.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const MAX_PAGES_PER_REQUEST = 1_000;

@Injectable()
export class MercadoLivreOrdersProvider implements MarketplaceOrdersProvider {
  constructor(private readonly client: MercadoLivreClient) {}

  async listOrders(
    params: ListMarketplaceOrdersParams,
  ): Promise<MarketplaceOrdersResult> {
    validateParams(params);

    const pageSize = params.limit ?? DEFAULT_PAGE_SIZE;
    let nextOffset = params.offset ?? 0;
    let partial = false;
    let pageCount = 0;
    const visitedResponseOffsets = new Set<number>();
    const orders: MarketplaceOrder[] = [];

    while (true) {
      pageCount += 1;
      if (pageCount > MAX_PAGES_PER_REQUEST) {
        throw new Error(
          'Mercado Livre pagination exceeded the safe page limit.',
        );
      }

      const response = await this.client.searchOrders(
        {
          seller: params.marketplaceAccount.externalAccountId,
          dateCreatedFrom: params.dateFrom.toISOString(),
          dateCreatedTo: params.dateTo.toISOString(),
          offset: nextOffset,
          limit: pageSize,
          sort: params.sort ?? 'date_asc',
        },
        params.marketplaceAccount,
      );
      const page = response.data;
      partial ||= response.partial;

      if (
        page.paging.offset !== nextOffset ||
        visitedResponseOffsets.has(page.paging.offset) ||
        !Number.isInteger(page.paging.limit) ||
        page.paging.limit < 1
      ) {
        throw new Error(
          'Mercado Livre returned inconsistent pagination metadata.',
        );
      }
      visitedResponseOffsets.add(page.paging.offset);

      orders.push(...page.results.map(mapMercadoLivreOrder));

      if (
        page.paging.offset + page.paging.limit >= page.paging.total
      ) {
        break;
      }

      nextOffset = page.paging.offset + page.paging.limit;
    }

    return { orders, partial };
  }
}

function validateParams(params: ListMarketplaceOrdersParams): void {
  if (
    params.marketplaceAccount.id.trim().length === 0 ||
    params.marketplaceAccount.externalAccountId.trim().length === 0
  ) {
    throw new Error('marketplaceAccount is required.');
  }

  if (
    Number.isNaN(params.dateFrom.getTime()) ||
    Number.isNaN(params.dateTo.getTime())
  ) {
    throw new Error('dateFrom and dateTo must be valid dates.');
  }

  if (params.dateFrom > params.dateTo) {
    throw new Error('dateFrom must not be after dateTo.');
  }

  if (
    params.offset !== undefined &&
    (!Number.isInteger(params.offset) || params.offset < 0)
  ) {
    throw new Error('offset must be a non-negative integer.');
  }

  if (
    params.limit !== undefined &&
    (!Number.isInteger(params.limit) ||
      params.limit < 1 ||
      params.limit > MAX_PAGE_SIZE)
  ) {
    throw new Error(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
}
