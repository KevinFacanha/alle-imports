import { Inject, Injectable } from '@nestjs/common';
import { MarketplaceAccount } from '@prisma/client';

import {
  MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER,
  MERCADO_LIVRE_FETCH,
  MERCADO_LIVRE_HTTP_TIMEOUT_MS,
  MercadoLivreAccessTokenProvider,
  MercadoLivreClientError,
} from './mercado-livre.client.js';
import {
  MercadoLivreCatalogBulkApiResult,
  MercadoLivreCatalogBulkResult,
  MercadoLivreCatalogItem,
  MercadoLivreCatalogLegacyBulkApiResult,
  MercadoLivreCatalogSearchResponse,
} from './mercado-livre-catalog.types.js';

const API_BASE_URL = 'https://api.mercadolibre.com';
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;

@Injectable()
export class MercadoLivreCatalogClient {
  constructor(
    @Inject(MERCADO_LIVRE_ACCESS_TOKEN_PROVIDER)
    private readonly accessTokenProvider: MercadoLivreAccessTokenProvider,
    @Inject(MERCADO_LIVRE_FETCH)
    private readonly fetchImplementation: typeof fetch,
    @Inject(MERCADO_LIVRE_HTTP_TIMEOUT_MS)
    private readonly timeoutMs: number,
  ) {}

  async searchSellerItems(
    sellerId: string,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
    scrollId?: string,
  ): Promise<MercadoLivreCatalogSearchResponse> {
    const url = new URL(
      `/users/${encodeURIComponent(sellerId)}/items/search`,
      API_BASE_URL,
    );
    url.searchParams.set('search_type', 'scan');
    url.searchParams.set('limit', '100');
    if (scrollId) {
      url.searchParams.set('scroll_id', scrollId);
    }

    return this.getJsonWithRetry(
      url,
      marketplaceAccount,
      parseCatalogSearchResponse,
      'catalog search',
    );
  }

  async getItems(
    itemIds: string[],
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<MercadoLivreCatalogBulkResult[]> {
    if (itemIds.length < 1 || itemIds.length > 20) {
      throw new Error('Mercado Livre bulk item requests require 1 to 20 IDs.');
    }

    const url = new URL('/items/bulk', API_BASE_URL);
    url.searchParams.set('ids', itemIds.join(','));
    url.searchParams.set('include_attributes', 'all');
    url.searchParams.set(
      'attributes',
      [
        'id',
        'status_code',
        'body.id',
        'body.title',
        'body.status',
        'body.seller_sku',
        'body.attributes',
        'body.variations',
      ].join(','),
    );

    return this.getJsonWithRetry(
      url,
      marketplaceAccount,
      parseCatalogBulkResponse,
      'catalog items',
    );
  }

  private async getJsonWithRetry<T>(
    url: URL,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
    parser: (value: unknown) => T | null,
    resourceName: string,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await this.fetchOnce(url, marketplaceAccount);

      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_ATTEMPTS) {
          await delay(retryDelayMs(response, attempt));
          continue;
        }
        throw new MercadoLivreClientError(
          response.status === 429
            ? 'Mercado Livre rate limit was reached.'
            : 'Mercado Livre is temporarily unavailable.',
          response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE',
          response.status,
          response.headers.get('retry-after') ?? undefined,
        );
      }

      if (response.status === 401) {
        throw new MercadoLivreClientError(
          'Mercado Livre authentication failed.',
          'UNAUTHORIZED',
          response.status,
        );
      }
      if (response.status === 403) {
        const diagnostic = await readErrorDiagnostic(response);
        throw new MercadoLivreClientError(
          'Mercado Livre denied access to the ' + resourceName + ' resource.',
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

      const parsed = parser(data);
      if (parsed === null) {
        if (resourceName === 'catalog items') {
          process.stderr.write(
            `${JSON.stringify({
              event: 'ml_catalog_bulk_unexpected_shape',
              firstElement: describeCatalogBulkFirstElement(data),
              firstInvalidElement: describeFirstInvalidCatalogBulkElement(data),
            })}\n`,
          );
        }
        throw new MercadoLivreClientError(
          `Mercado Livre returned an unexpected ${resourceName} response.`,
          'INVALID_RESPONSE',
          response.status,
        );
      }
      return parsed;
    }

    throw new MercadoLivreClientError(
      'Mercado Livre request failed.',
      'UPSTREAM_UNAVAILABLE',
    );
  }

  private async fetchOnce(
    url: URL,
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<Response> {
    const accessToken = await this.accessTokenProvider.getAccessToken(
      marketplaceAccount,
    );
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      return await this.fetchImplementation(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal: abortController.signal,
      });
    } catch (error: unknown) {
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

function describeCatalogBulkFirstElement(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return { responseType: valueType(value) };
  }
  const first = value[0];
  if (!isRecord(first)) {
    return {
      responseType: 'array',
      firstElementType: valueType(first),
    };
  }
  const body = first.body;
  return {
    responseType: 'array',
    properties: Object.keys(first).sort(),
    propertyTypes: propertyTypes(first),
    statusCode:
      typeof first.status_code === 'number' ? first.status_code : undefined,
    legacyCode: typeof first.code === 'number' ? first.code : undefined,
    hasId: Object.hasOwn(first, 'id'),
    hasBody: Object.hasOwn(first, 'body'),
    ...(isRecord(body)
      ? {
          bodyProperties: Object.keys(body).sort(),
          bodyPropertyTypes: propertyTypes(body),
        }
      : {}),
  };
}

function describeFirstInvalidCatalogBulkElement(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;

  for (const [index, element] of value.entries()) {
    const envelope = parseCatalogBulkEnvelope(element);
    if (envelope === null) {
      return { index, issue: 'invalid_envelope' };
    }
    const item = parseCatalogItem(envelope.body);
    if (envelope.statusCode === 200 && item === null) {
      return {
        index,
        issue: 'invalid_success_body',
        bodyValidation: describeCatalogItemValidation(envelope.body),
      };
    }
    if (item !== null && item.id !== envelope.id) {
      return { index, issue: 'envelope_body_id_mismatch' };
    }
  }

  return undefined;
}

function describeCatalogItemValidation(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { issue: 'body_not_object', type: valueType(value) };
  if (typeof value.id !== 'string') {
    return { issue: 'body_id_not_string', type: valueType(value.id) };
  }
  for (const property of ['title', 'status', 'seller_sku'] as const) {
    if (!isNullableString(value[property])) {
      return {
        issue: 'body_property_not_nullable_string',
        property,
        type: valueType(value[property]),
      };
    }
  }

  const invalidAttribute = describeInvalidAttribute(value.attributes);
  if (invalidAttribute) {
    return { issue: 'invalid_body_attributes', ...invalidAttribute };
  }
  if (value.variations !== undefined && !Array.isArray(value.variations)) {
    return { issue: 'variations_not_array', type: valueType(value.variations) };
  }
  if (Array.isArray(value.variations)) {
    for (const [index, variation] of value.variations.entries()) {
      if (!isRecord(variation)) {
        return {
          issue: 'variation_not_object',
          index,
          type: valueType(variation),
        };
      }
      if (typeof variation.id !== 'string' && typeof variation.id !== 'number') {
        return {
          issue: 'variation_id_invalid',
          index,
          type: valueType(variation.id),
        };
      }
      if (!isNullableString(variation.seller_sku)) {
        return {
          issue: 'variation_seller_sku_invalid',
          index,
          type: valueType(variation.seller_sku),
        };
      }
      for (const property of ['attribute_combinations', 'attributes'] as const) {
        const invalid = describeInvalidAttribute(variation[property]);
        if (invalid) {
          return {
            issue: 'invalid_variation_attributes',
            index,
            property,
            ...invalid,
          };
        }
      }
    }
  }
  return { issue: 'unknown_item_validation_failure' };
}

function describeInvalidAttribute(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    return { attributeIssue: 'not_array', type: valueType(value) };
  }
  for (const [index, attribute] of value.entries()) {
    if (!isRecord(attribute)) {
      return {
        attributeIssue: 'not_object',
        attributeIndex: index,
        type: valueType(attribute),
      };
    }
    if (typeof attribute.id !== 'string' && attribute.id !== null) {
      return {
        attributeIssue: 'id_not_nullable_string',
        attributeIndex: index,
        type: valueType(attribute.id),
        properties: Object.keys(attribute).sort(),
        propertyTypes: propertyTypes(attribute),
      };
    }
    for (const property of ['name', 'value_name'] as const) {
      if (!isNullableString(attribute[property])) {
        return {
          attributeIssue: 'property_not_nullable_string',
          attributeIndex: index,
          property,
          type: valueType(attribute[property]),
          properties: Object.keys(attribute).sort(),
          propertyTypes: propertyTypes(attribute),
        };
      }
    }
  }
  return undefined;
}

function propertyTypes(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, propertyValue]) => [key, valueType(propertyValue)]),
  );
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseCatalogSearchResponse(
  value: unknown,
): MercadoLivreCatalogSearchResponse | null {
  if (value === null) return { results: null, scroll_id: null };
  if (!isRecord(value)) return null;
  if (
    value.results !== null &&
    (!Array.isArray(value.results) ||
      !value.results.every((itemId) => typeof itemId === 'string'))
  ) {
    return null;
  }
  if (
    value.scroll_id !== undefined &&
    value.scroll_id !== null &&
    typeof value.scroll_id !== 'string'
  ) {
    return null;
  }
  return {
    results: value.results as string[] | null,
    scroll_id: value.scroll_id as string | null | undefined,
  };
}

function parseCatalogBulkResponse(
  value: unknown,
): MercadoLivreCatalogBulkResult[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MercadoLivreCatalogBulkResult[] = [];

  for (const result of value) {
    const envelope = parseCatalogBulkEnvelope(result);
    if (envelope === null) return null;

    const item = parseCatalogItem(envelope.body);
    if (envelope.statusCode === 200 && item === null) return null;
    if (item !== null && item.id !== envelope.id) return null;

    parsed.push({
      id: envelope.id,
      statusCode: envelope.statusCode,
      ...(item ? { body: item } : {}),
    });
  }
  return parsed;
}

interface ParsedCatalogBulkEnvelope {
  id: string;
  statusCode: number;
  body: unknown;
}

function parseCatalogBulkEnvelope(
  value: unknown,
): ParsedCatalogBulkEnvelope | null {
  if (!isRecord(value)) return null;

  if (isCurrentCatalogBulkEnvelope(value)) {
    return {
      id: value.id,
      statusCode: value.status_code,
      body: value.body,
    };
  }

  if (isLegacyCatalogBulkEnvelope(value)) {
    return {
      id: value.body.id,
      statusCode: value.code,
      body: value.body,
    };
  }

  return null;
}

function isCurrentCatalogBulkEnvelope(
  value: Record<string, unknown>,
): value is MercadoLivreCatalogBulkApiResult & Record<string, unknown> {
  return typeof value.id === 'string' && typeof value.status_code === 'number';
}

function isLegacyCatalogBulkEnvelope(
  value: Record<string, unknown>,
): value is MercadoLivreCatalogLegacyBulkApiResult & Record<string, unknown> {
  return (
    value.id === undefined &&
    value.status_code === undefined &&
    typeof value.code === 'number' &&
    isRecord(value.body) &&
    typeof value.body.id === 'string'
  );
}

function parseCatalogItem(value: unknown): MercadoLivreCatalogItem | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  if (!isNullableString(value.title) || !isNullableString(value.status)) {
    return null;
  }
  if (!isNullableString(value.seller_sku)) return null;
  if (!isAttributeArray(value.attributes)) return null;
  if (
    value.variations !== undefined &&
    (!Array.isArray(value.variations) ||
      !value.variations.every(
        (variation) =>
          isRecord(variation) &&
          (typeof variation.id === 'string' ||
            typeof variation.id === 'number') &&
          isNullableString(variation.seller_sku) &&
          isAttributeArray(variation.attribute_combinations) &&
          isAttributeArray(variation.attributes),
      ))
  ) {
    return null;
  }
  return value as unknown as MercadoLivreCatalogItem;
}

function isAttributeArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (attribute) =>
          isRecord(attribute) &&
          (typeof attribute.id === 'string' || attribute.id === null) &&
          isNullableString(attribute.name) &&
          isNullableString(attribute.value_name),
      ))
  );
}

function isNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
    }
  }
  return Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface ErrorDiagnostic {
  upstreamCode?: string;
  blockedBy?: string;
}

async function readErrorDiagnostic(response: Response): Promise<ErrorDiagnostic> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  if (!isRecord(body)) return {};
  const upstreamCode = safeIdentifier(body.code ?? body.error);
  const blockedBy = safeIdentifier(body.blocked_by);
  return {
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length >= 1 &&
    value.length <= 100 &&
    !new RegExp('[^A-Za-z0-9_.:-]').test(value)
    ? value
    : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
