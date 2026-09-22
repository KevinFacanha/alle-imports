import { Inject, Injectable } from '@nestjs/common';
import { MarketplaceAccount } from '@prisma/client';

import {
  MercadoLivreHttpResult,
  MercadoLivreOrdersSearchParams,
  MercadoLivreOrdersSearchResponse,
  MercadoLivreShipment,
  MercadoLivreUserVisitsResponse,
} from './mercado-livre.types.js';

const ORDERS_SEARCH_URL = 'https://api.mercadolibre.com/orders/search';

export const MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER = Symbol(
  'MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER',
);
export const MERCADO_LIVRE_FETCH = Symbol('MERCADO_LIVRE_FETCH');
export const MERCADO_LIVRE_HTTP_TIMEOUT_MS = Symbol(
  'MERCADO_LIVRE_HTTP_TIMEOUT_MS',
);

export interface MercadoLivreAccessTokenProvider {
  getAccessToken(
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<string> | string;
}

export type MercadoLivreClientErrorCode =
  | 'UNAUTHORIZED'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'REQUEST_FAILED'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

export class MercadoLivreClientError extends Error {
  constructor(
    message: string,
    readonly code: MercadoLivreClientErrorCode,
    readonly statusCode?: number,
    readonly retryAfter?: string,
    readonly upstreamCode?: string,
    readonly blockedBy?: string,
  ) {
    super(message);
    this.name = 'MercadoLivreClientError';
  }
}

@Injectable()
export class MercadoLivreClient {
  constructor(
    @Inject(MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER)
    private readonly accessTokenProvider: MercadoLivreAccessTokenProvider,
    @Inject(MERCADO_LIVRE_FETCH)
    private readonly fetchImplementation: typeof fetch,
    @Inject(MERCADO_LIVRE_HTTP_TIMEOUT_MS)
    private readonly timeoutMs: number,
  ) {}

  async searchOrders(
    params: MercadoLivreOrdersSearchParams,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<MercadoLivreHttpResult<MercadoLivreOrdersSearchResponse>> {
    const accessToken = await this.accessTokenProvider.getAccessToken(
      marketplaceAccount,
    );
    const url = new URL(ORDERS_SEARCH_URL);
    url.searchParams.set('seller', params.seller);
    url.searchParams.set('order.date_created.from', params.dateCreatedFrom);
    url.searchParams.set('order.date_created.to', params.dateCreatedTo);
    url.searchParams.set('offset', String(params.offset));
    url.searchParams.set('limit', String(params.limit));
    url.searchParams.set('sort', params.sort);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal: abortController.signal,
      });

      if (response.status === 401) {
        throw new MercadoLivreClientError(
          'Mercado Livre authentication failed.',
          'UNAUTHORIZED',
          response.status,
        );
      }

      if (response.status === 429) {
        throw new MercadoLivreClientError(
          'Mercado Livre rate limit was reached.',
          'RATE_LIMITED',
          response.status,
          response.headers.get('retry-after') ?? undefined,
        );
      }

      if (response.status >= 500) {
        throw new MercadoLivreClientError(
          'Mercado Livre is temporarily unavailable.',
          'UPSTREAM_UNAVAILABLE',
          response.status,
        );
      }

      if (response.status === 403) {
        const diagnostic = await readUpstreamErrorDiagnostic(response);
        throw new MercadoLivreClientError(
          'Mercado Livre denied access to the orders resource.',
          'ACCESS_DENIED',
          response.status,
          undefined,
          diagnostic.upstreamCode,
          diagnostic.blockedBy,
        );
      }

      if (!response.ok) {
        throw new MercadoLivreClientError(
          'Mercado Livre rejected the orders request.',
          'REQUEST_FAILED',
          response.status,
        );
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new MercadoLivreClientError(
          'Mercado Livre returned an invalid JSON response.',
          'INVALID_RESPONSE',
          response.status,
        );
      }

      if (!isOrdersSearchResponse(data)) {
        throw new MercadoLivreClientError(
          'Mercado Livre returned an unexpected orders response.',
          'INVALID_RESPONSE',
          response.status,
        );
      }

      return {
        data,
        partial: response.status === 206,
      };
    } catch (error: unknown) {
      if (error instanceof MercadoLivreClientError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new MercadoLivreClientError(
          'Mercado Livre request timed out.',
          'TIMEOUT',
        );
      }

      throw new MercadoLivreClientError(
        'Mercado Livre request failed.',
        'UPSTREAM_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getUserVisits(
    userId: string,
    dateFrom: string,
    dateTo: string,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<MercadoLivreUserVisitsResponse> {
    const url = new URL(
      `https://api.mercadolibre.com/users/${encodeURIComponent(userId)}/items_visits`,
    );
    url.searchParams.set('date_from', dateFrom);
    url.searchParams.set('date_to', dateTo);

    const response = await this.getJson(
      url,
      marketplaceAccount,
      isUserVisitsResponse,
      'visits',
    );
    if (response === null) {
      throw new MercadoLivreClientError(
        'Mercado Livre returned an unexpected visits response.',
        'INVALID_RESPONSE',
      );
    }
    return response;
  }

  async getOrderShipments(
    externalOrderId: string,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<MercadoLivreShipment[]> {
    const url = new URL(
      `https://api.mercadolibre.com/orders/${encodeURIComponent(externalOrderId)}/shipments`,
    );

    const response = await this.getJson(
      url,
      marketplaceAccount,
      isOrderShipmentsResponse,
      'order shipments',
      { 'X-New-Domain': 'true' },
      true,
    );

    if (response === null) {
      return [];
    }
    return Array.isArray(response) ? response : [response];
  }

  private async getJson<T>(
    url: URL,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
    validator: (value: unknown) => value is T,
    resourceName: string,
    extraHeaders: HeadersInit = {},
    notFoundAsNull = false,
  ): Promise<T | null> {
    const accessToken = await this.accessTokenProvider.getAccessToken(
      marketplaceAccount,
    );
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...extraHeaders,
        },
        signal: abortController.signal,
      });

      if (response.status === 404 && notFoundAsNull) {
        return null;
      }
      if (response.status === 401) {
        throw new MercadoLivreClientError(
          'Mercado Livre authentication failed.',
          'UNAUTHORIZED',
          response.status,
        );
      }
      if (response.status === 429) {
        throw new MercadoLivreClientError(
          'Mercado Livre rate limit was reached.',
          'RATE_LIMITED',
          response.status,
          response.headers.get('retry-after') ?? undefined,
        );
      }
      if (response.status >= 500) {
        throw new MercadoLivreClientError(
          'Mercado Livre is temporarily unavailable.',
          'UPSTREAM_UNAVAILABLE',
          response.status,
        );
      }
      if (response.status === 403) {
        const diagnostic = await readUpstreamErrorDiagnostic(response);
        throw new MercadoLivreClientError(
          `Mercado Livre denied access to the ${resourceName} resource.`,
          'ACCESS_DENIED',
          response.status,
          undefined,
          diagnostic.upstreamCode,
          diagnostic.blockedBy,
        );
      }
      if (!response.ok) {
        throw new MercadoLivreClientError(
          `Mercado Livre rejected the ${resourceName} request.`,
          'REQUEST_FAILED',
          response.status,
        );
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new MercadoLivreClientError(
          'Mercado Livre returned an invalid JSON response.',
          'INVALID_RESPONSE',
          response.status,
        );
      }

      if (!validator(data)) {
        throw new MercadoLivreClientError(
          `Mercado Livre returned an unexpected ${resourceName} response.`,
          'INVALID_RESPONSE',
          response.status,
        );
      }
      return data;
    } catch (error: unknown) {
      if (error instanceof MercadoLivreClientError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new MercadoLivreClientError(
          'Mercado Livre request timed out.',
          'TIMEOUT',
        );
      }
      throw new MercadoLivreClientError(
        'Mercado Livre request failed.',
        'UPSTREAM_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isOrdersSearchResponse(
  value: unknown,
): value is MercadoLivreOrdersSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return false;
  }

  const paging = value.paging;
  return (
    isRecord(paging) &&
    typeof paging.total === 'number' &&
    typeof paging.offset === 'number' &&
    typeof paging.limit === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUserVisitsResponse(
  value: unknown,
): value is MercadoLivreUserVisitsResponse {
  return (
    isRecord(value) &&
    (typeof value.user_id === 'string' || typeof value.user_id === 'number') &&
    typeof value.date_from === 'string' &&
    typeof value.date_to === 'string' &&
    typeof value.total_visits === 'number' &&
    Number.isSafeInteger(value.total_visits) &&
    value.total_visits >= 0
  );
}

function isOrderShipmentsResponse(
  value: unknown,
): value is MercadoLivreShipment | MercadoLivreShipment[] {
  const shipments = Array.isArray(value) ? value : [value];
  return shipments.every(
    (shipment) =>
      isRecord(shipment) &&
      (typeof shipment.id === 'string' || typeof shipment.id === 'number') &&
      (shipment.logistic_type === null ||
        typeof shipment.logistic_type === 'string'),
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

interface UpstreamErrorDiagnostic {
  upstreamCode?: string;
  blockedBy?: string;
}

async function readUpstreamErrorDiagnostic(
  response: Response,
): Promise<UpstreamErrorDiagnostic> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  if (!isRecord(body)) return {};

  const upstreamCode = safeDiagnosticIdentifier(body.code ?? body.error);
  const blockedBy = safeDiagnosticIdentifier(body.blocked_by);
  return {
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function safeDiagnosticIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value)
    ? value
    : undefined;
}
