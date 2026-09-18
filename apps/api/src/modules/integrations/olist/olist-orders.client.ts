import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OlistAuthorizationService } from './olist-authorization.service.js';
import {
  OlistOrder,
  OlistOrderListParams,
  OlistOrderItem,
} from './olist-orders.types.js';

const ORDERS_URL = 'https://api.tiny.com.br/public-api/v3/pedidos';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export const OLIST_ORDERS_FETCH = Symbol('OLIST_ORDERS_FETCH');
export const OLIST_ORDERS_TIMEOUT_MS = Symbol('OLIST_ORDERS_TIMEOUT_MS');
export const OLIST_ORDERS_REQUEST_INTERVAL_MS = Symbol(
  'OLIST_ORDERS_REQUEST_INTERVAL_MS',
);

export type OlistOrdersClientErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'REQUEST_FAILED'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

export class OlistOrdersClientError extends Error {
  constructor(
    message: string,
    readonly code: OlistOrdersClientErrorCode,
    readonly statusCode?: number,
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = 'OlistOrdersClientError';
  }
}

interface OlistOrderSummary {
  id: string;
  orderNumber: string | null;
  createdAt: string | null;
  statusCode: number | null;
  ecommerce: SafeEcommerce;
}

interface SafeEcommerce {
  name: string | null;
  ecommerceOrderId: string | null;
  salesChannelOrderId: string | null;
  salesChannel: string | null;
}

interface PageResult {
  items: OlistOrderSummary[];
  pagination: { limit: number; offset: number; total: number };
}

interface OlistAccessTokenProvider {
  getAccessToken(account: { id: string }): Promise<string> | string;
}

@Injectable()
export class OlistOrdersClient {
  private lastRequestStartedAt = 0;

  constructor(
    private readonly authorization: OlistAuthorizationService,
    @Inject(OLIST_ORDERS_FETCH)
    private readonly fetchImplementation: typeof fetch,
    @Inject(OLIST_ORDERS_TIMEOUT_MS)
    private readonly timeoutMs: number,
    @Inject(OLIST_ORDERS_REQUEST_INTERVAL_MS)
    private readonly requestIntervalMs: number,
  ) {}

  async listOrders(params: OlistOrderListParams): Promise<OlistOrder[]> {
    assertCalendarDate(params.date);
    const limit = params.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new OlistOrdersClientError(
        'Olist orders limit must be an integer between 1 and 100.',
        'REQUEST_FAILED',
      );
    }

    const summaries: OlistOrderSummary[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    while (offset < total) {
      const page = await this.listPage(params.account, params.date, limit, offset);
      if (page.pagination.offset !== offset || page.pagination.limit < 1) {
        throw invalidResponse('pagination');
      }
      summaries.push(...page.items);
      total = page.pagination.total;
      const nextOffset = offset + page.pagination.limit;
      if (nextOffset <= offset) {
        throw invalidResponse('pagination');
      }
      offset = nextOffset;
    }

    const inLocalDay = summaries.filter((summary) =>
      belongsToLocalDate(summary.createdAt, params.date, params.timeZone),
    );
    const orders: OlistOrder[] = [];
    for (const summary of inLocalDay) {
      orders.push(await this.getOrder(params.account, summary));
    }
    return orders;
  }

  private async listPage(
    account: { id: string },
    date: string,
    limit: number,
    offset: number,
  ): Promise<PageResult> {
    const url = new URL(ORDERS_URL);
    // Olist V3 documents both fields as creation-date filters. They are date
    // values (not instants), so the requested local calendar date is sent in
    // both fields and the response is then guarded locally.
    url.searchParams.set('dataInicial', date);
    url.searchParams.set('dataFinal', date);
    url.searchParams.set('orderBy', 'asc');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const body = await this.getJson(url, account);
    if (!isRecord(body) || !Array.isArray(body.itens)) {
      throw invalidResponse('orders list');
    }
    const pagination = mapPagination(body.paginacao);
    const items = body.itens.map(mapSummary);
    return { items, pagination };
  }

  private async getOrder(
    account: { id: string },
    summary: OlistOrderSummary,
  ): Promise<OlistOrder> {
    const url = new URL(`${ORDERS_URL}/${encodeURIComponent(summary.id)}`);
    const body = await this.getJson(url, account);
    if (!isRecord(body)) {
      throw invalidResponse('order detail');
    }

    const id = scalarString(body.id);
    if (id !== summary.id) {
      throw invalidResponse('order detail identifier');
    }
    const ecommerce = mergeEcommerce(mapEcommerce(body.ecommerce), summary.ecommerce);
    const items = Array.isArray(body.itens)
      ? body.itens.map(mapItem)
      : [];

    return {
      olistOrderId: id,
      orderNumber: scalarString(body.numeroPedido) ?? summary.orderNumber,
      ecommerceOrderId: ecommerce.ecommerceOrderId,
      salesChannelOrderId: ecommerce.salesChannelOrderId,
      createdAt: summary.createdAt,
      date: safeString(body.data) ?? summary.createdAt,
      statusCode: safeInteger(body.situacao) ?? summary.statusCode,
      status: statusLabel(safeInteger(body.situacao) ?? summary.statusCode),
      ecommerce: ecommerce.name,
      salesChannel: ecommerce.salesChannel,
      totalAmount: decimal(body.valorTotalPedido, 'valorTotalPedido'),
      productTotalAmount: optionalDecimal(
        body.valorTotalProdutos,
        'valorTotalProdutos',
      ),
      discountAmount: decimal(body.valorDesconto, 'valorDesconto'),
      freightAmount: decimal(body.valorFrete, 'valorFrete'),
      otherExpensesAmount: optionalDecimal(
        body.valorOutrasDespesas,
        'valorOutrasDespesas',
      ),
      items,
    };
  }

  private async getJson(url: URL, account: { id: string }): Promise<unknown> {
    await this.waitForRequestSlot();
    const accessToken = await (
      this.authorization as unknown as OlistAccessTokenProvider
    ).getAccessToken(account);
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
      if (!response.ok) {
        throw httpError(response);
      }
      try {
        return await response.json();
      } catch {
        throw invalidResponse('JSON');
      }
    } catch (error: unknown) {
      if (error instanceof OlistOrdersClientError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new OlistOrdersClientError('Olist orders request timed out.', 'TIMEOUT');
      }
      throw new OlistOrdersClientError(
        'Olist orders request failed.',
        'UPSTREAM_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRequestSlot(): Promise<void> {
    const waitMs = Math.max(
      0,
      this.lastRequestStartedAt + this.requestIntervalMs - Date.now(),
    );
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestStartedAt = Date.now();
  }
}

function mapSummary(value: unknown): OlistOrderSummary {
  if (!isRecord(value)) {
    throw invalidResponse('order summary');
  }
  const id = scalarString(value.id);
  if (!id) {
    throw invalidResponse('order summary identifier');
  }
  return {
    id,
    orderNumber: scalarString(value.numeroPedido),
    createdAt: safeString(value.dataCriacao),
    statusCode: safeInteger(value.situacao),
    ecommerce: mapEcommerce(value.ecommerce),
  };
}

function mapItem(value: unknown): OlistOrderItem {
  if (!isRecord(value)) {
    throw invalidResponse('order item');
  }
  const product = isRecord(value.produto) ? value.produto : {};
  return {
    sku: safeString(product.sku),
    product: safeString(product.descricao),
    quantity: decimal(value.quantidade, 'item.quantidade'),
    unitPrice: decimal(value.valorUnitario, 'item.valorUnitario'),
  };
}

function mapEcommerce(value: unknown): SafeEcommerce {
  const ecommerce = isRecord(value) ? value : {};
  return {
    name: safeString(ecommerce.nome),
    ecommerceOrderId: scalarString(ecommerce.numeroPedidoEcommerce),
    salesChannelOrderId: scalarString(ecommerce.numeroPedidoCanalVenda),
    salesChannel: safeString(ecommerce.canalVenda),
  };
}

function mergeEcommerce(primary: SafeEcommerce, fallback: SafeEcommerce): SafeEcommerce {
  return {
    name: primary.name ?? fallback.name,
    ecommerceOrderId: primary.ecommerceOrderId ?? fallback.ecommerceOrderId,
    salesChannelOrderId:
      primary.salesChannelOrderId ?? fallback.salesChannelOrderId,
    salesChannel: primary.salesChannel ?? fallback.salesChannel,
  };
}

function mapPagination(value: unknown): PageResult['pagination'] {
  if (!isRecord(value)) {
    throw invalidResponse('pagination');
  }
  const limit = safeInteger(value.limit);
  const offset = safeInteger(value.offset);
  const total = safeInteger(value.total);
  if (limit === null || offset === null || total === null || total < 0 || offset < 0) {
    throw invalidResponse('pagination');
  }
  return { limit, offset, total };
}

function belongsToLocalDate(
  value: string | null,
  expectedDate: string,
  timeZone: string,
): boolean {
  if (value === null) {
    return false;
  }
  const leadingDate = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(value)?.[1];
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (leadingDate && !hasExplicitOffset) {
    return leadingDate === expectedDate;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidResponse('order creation date');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}` === expectedDate;
}

function assertCalendarDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!match || month < 1 || month > 12 || day < 1 || day > days) {
    throw new OlistOrdersClientError(
      'date must be a valid calendar date in YYYY-MM-DD format.',
      'REQUEST_FAILED',
    );
  }
}

function decimal(value: unknown, field: string): Prisma.Decimal {
  if (value === null || value === undefined || value === '') {
    return new Prisma.Decimal(0);
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw invalidResponse(field);
  }
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    throw invalidResponse(field);
  }
}

function optionalDecimal(
  value: unknown,
  field: string,
): Prisma.Decimal | null {
  return value === null || value === undefined || value === ''
    ? null
    : decimal(value, field);
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return safeString(value);
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function statusLabel(status: number | null): string {
  const labels: Record<number, string> = {
    8: 'DADOS_INCOMPLETOS',
    0: 'ABERTA',
    3: 'APROVADA',
    4: 'PREPARANDO_ENVIO',
    1: 'FATURADA',
    7: 'PRONTO_ENVIO',
    5: 'ENVIADA',
    6: 'ENTREGUE',
    2: 'CANCELADA',
    9: 'NAO_ENTREGUE',
  };
  return status === null ? 'DESCONHECIDA' : (labels[status] ?? `DESCONHECIDA_${status}`);
}

function httpError(response: Response): OlistOrdersClientError {
  if (response.status === 401) {
    return new OlistOrdersClientError('Olist authentication failed.', 'UNAUTHORIZED', 401);
  }
  if (response.status === 403) {
    return new OlistOrdersClientError('Olist orders access was forbidden.', 'FORBIDDEN', 403);
  }
  if (response.status === 429) {
    return new OlistOrdersClientError(
      'Olist orders rate limit was reached.',
      'RATE_LIMITED',
      429,
      response.headers.get('retry-after') ?? undefined,
    );
  }
  if (response.status >= 500) {
    return new OlistOrdersClientError(
      'Olist orders service is temporarily unavailable.',
      'UPSTREAM_UNAVAILABLE',
      response.status,
    );
  }
  return new OlistOrdersClientError(
    'Olist rejected the orders request.',
    'REQUEST_FAILED',
    response.status,
  );
}

function invalidResponse(resource: string): OlistOrdersClientError {
  return new OlistOrdersClientError(
    `Olist returned an unexpected ${resource} response.`,
    'INVALID_RESPONSE',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
