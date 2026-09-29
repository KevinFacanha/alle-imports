import { Injectable } from '@nestjs/common';

import {
  ListMarketplaceOrdersParams,
  MarketplaceOrdersProvider,
} from '../domain/marketplace-orders.provider.js';
import {
  MarketplaceOrder,
  MarketplaceOrdersPage,
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

      const page = await this.listOrdersPage({
        ...params,
        offset: nextOffset,
      });
      partial ||= page.partial;

      if (visitedResponseOffsets.has(page.offset)) {
        throw new Error('Mercado Livre returned repeated pagination metadata.');
      }
      visitedResponseOffsets.add(page.offset);
      orders.push(...page.orders);

      if (!page.hasMore || page.nextOffset === null) {
        break;
      }
      nextOffset = page.nextOffset;
    }

    return { orders, partial };
  }

  async listOrdersPage(
    params: ListMarketplaceOrdersParams,
  ): Promise<MarketplaceOrdersPage> {
    validateParams(params);
    const offset = params.offset ?? 0;
    const response = await this.client.searchOrders(
      {
        seller: params.marketplaceAccount.externalAccountId,
        dateCreatedFrom: params.dateFrom.toISOString(),
        dateCreatedTo: params.dateTo.toISOString(),
        offset,
        limit: params.limit ?? DEFAULT_PAGE_SIZE,
        sort: params.sort ?? 'date_asc',
      },
      params.marketplaceAccount,
    );
    const page = response.data;
    if (
      page.paging.offset !== offset ||
      !Number.isInteger(page.paging.total) ||
      page.paging.total < 0 ||
      !Number.isInteger(page.paging.limit) ||
      page.paging.limit < 1
    ) {
      throw new Error('Mercado Livre returned inconsistent pagination metadata.');
    }

    const nextOffset = page.paging.offset + page.paging.limit;
    const hasMore = nextOffset < page.paging.total;
    return {
      orders: page.results
        .map(mapMercadoLivreOrder)
        .filter(
          (order) =>
            order.soldAt >= params.dateFrom && order.soldAt < params.dateTo,
        ),
      offset: page.paging.offset,
      nextOffset: hasMore ? nextOffset : null,
      total: page.paging.total,
      partial: response.partial,
      hasMore,
    };
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

  if (params.dateFrom >= params.dateTo) {
    throw new Error('dateFrom must be before dateTo.');
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
