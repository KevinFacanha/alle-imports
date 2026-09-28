import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Marketplace, MarketplaceAccount } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import { MercadoLivreCatalogClient } from './mercado-livre-catalog.client.js';
import {
  CatalogSyncSummary,
  MercadoLivreCatalogSyncService,
  NormalizedCatalogListing,
  SyncAccountResult,
  normalizeCatalogItem,
} from './mercado-livre-catalog-sync.service.js';

const ACCESS_TOKEN = 'catalog-test-token-that-must-stay-secret';
const ACCOUNT: MarketplaceAccount = {
  id: '00000000-0000-4000-8000-000000000001',
  businessAccountId: null,
  marketplace: Marketplace.MERCADO_LIVRE,
  externalAccountId: '740458955',
  name: 'C1',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('MercadoLivreCatalogClient', () => {
  it('uses scan pagination and the official bulk endpoint without token in URL', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ results: ['MLB1'], scroll_id: 'scroll-1' }),
      jsonResponse([
        {
          id: 'MLB1',
          status_code: 200,
          body: {
            id: 'MLB1',
            title: 'Produto',
            status: 'active',
            attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-1' }],
            variations: [],
          },
        },
      ]),
    ]);

    await client.searchSellerItems('740458955', ACCOUNT);
    const items = await client.getItems(['MLB1'], ACCOUNT);

    assert.equal(calls[0]?.url.pathname, '/users/740458955/items/search');
    assert.equal(calls[0]?.url.searchParams.get('search_type'), 'scan');
    assert.equal(calls[0]?.url.searchParams.get('limit'), '100');
    assert.equal(calls[1]?.url.pathname, '/items/bulk');
    assert.equal(calls[1]?.url.searchParams.get('ids'), 'MLB1');
    assert.equal(calls[1]?.url.searchParams.get('include_attributes'), 'all');
    assert.deepEqual(
      calls[1]?.url.searchParams.get('attributes')?.split(','),
      [
        'id',
        'status_code',
        'body.id',
        'body.title',
        'body.status',
        'body.seller_sku',
        'body.attributes',
        'body.variations',
      ],
    );
    assert.deepEqual(items, [
      {
        id: 'MLB1',
        statusCode: 200,
        body: {
          id: 'MLB1',
          title: 'Produto',
          status: 'active',
          attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-1' }],
          variations: [],
        },
      },
    ]);
    assert.equal(calls[0]?.url.toString().includes(ACCESS_TOKEN), false);
    assert.equal(
      new Headers(calls[0]?.init.headers).get('authorization'),
      `Bearer ${ACCESS_TOKEN}`,
    );
  });

  it('parses variations and their SELLER_SKU attributes from the current envelope', async () => {
    const { client } = makeClient([
      jsonResponse([
        {
          id: 'MLB2',
          status_code: 200,
          body: {
            id: 'MLB2',
            title: 'Camiseta',
            status: 'active',
            attributes: [],
            variations: [
              {
                id: 10,
                attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-VAR-10' }],
                attribute_combinations: [
                  { id: 'COLOR', name: 'Cor', value_name: 'Azul' },
                ],
              },
            ],
          },
        },
      ]),
    ]);

    const items = await client.getItems(['MLB2'], ACCOUNT);

    assert.equal(items[0]?.statusCode, 200);
    assert.equal(items[0]?.body?.variations?.[0]?.id, 10);
    assert.equal(
      items[0]?.body?.variations?.[0]?.attributes?.[0]?.value_name,
      'SKU-VAR-10',
    );
  });

  it('keeps an individual bulk error without accepting its body as an item', async () => {
    const { client } = makeClient([
      jsonResponse([
        {
          id: 'MLB404',
          status_code: 404,
          body: { message: 'Item not found', error: 'not_found' },
        },
      ]),
    ]);

    const items = await client.getItems(['MLB404'], ACCOUNT);

    assert.deepEqual(items, [{ id: 'MLB404', statusCode: 404 }]);
  });

  it('supports the legacy code/body envelope only when body.id is valid', async () => {
    const { client } = makeClient([
      jsonResponse([
        {
          code: 200,
          body: {
            id: 'MLB-LEGACY',
            title: 'Legado',
            status: 'paused',
            attributes: [],
            variations: [],
          },
        },
      ]),
    ]);

    const items = await client.getItems(['MLB-LEGACY'], ACCOUNT);

    assert.equal(items[0]?.id, 'MLB-LEGACY');
    assert.equal(items[0]?.statusCode, 200);
  });

  it('rejects an unexpected bulk envelope instead of silently falling back', async () => {
    const { client } = makeClient([
      jsonResponse([
        {
          body: {
            id: 'MLB1',
            title: 'Produto',
            status: 'active',
            attributes: [],
            variations: [],
          },
        },
      ]),
    ]);

    await assert.rejects(
      client.getItems(['MLB1'], ACCOUNT),
      /Mercado Livre returned an unexpected catalog items response/,
    );
  });

  it('retries only a limited number of 429/5xx responses', async () => {
    const { client, calls } = makeClient([
      jsonResponse({}, 429, { 'retry-after': '0' }),
      jsonResponse({}, 503, { 'retry-after': '0' }),
      jsonResponse({ results: [], scroll_id: null }),
    ]);

    const response = await client.searchSellerItems('740458955', ACCOUNT);

    assert.deepEqual(response.results, []);
    assert.equal(calls.length, 3);
  });
});

describe('normalizeCatalogItem', () => {
  it('maps an item without variations using listing ID as sellable identity', () => {
    const listing = normalizeCatalogItem({
      id: 'MLB1',
      title: 'Produto simples',
      status: 'paused',
      attributes: [
        { id: null, name: 'Sem identificador', value_name: 'Ignorar' },
        { id: 'SELLER_SKU', value_name: 'SKU-1' },
      ],
      variations: [],
    });

    assert.deepEqual(listing, {
      externalListingId: 'MLB1',
      title: 'Produto simples',
      status: 'paused',
      hasVariations: false,
      items: [
        {
          externalSellableId: 'MLB1',
          sellerSku: 'SKU-1',
          sellerSkuSource: 'item',
          variationLabel: null,
          active: false,
        },
      ],
    });
  });

  it('maps each variation independently without inheriting the listing SKU', () => {
    const listing = normalizeCatalogItem({
      id: 'MLB2',
      title: 'Camiseta',
      status: 'active',
      attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-DO-ANUNCIO' }],
      seller_custom_field: 'NAO-USAR-NO-ANUNCIO',
      variations: [
        {
          id: 10,
          attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-AZUL' }],
          attribute_combinations: [
            { id: null, name: 'Cor', value_name: 'Azul' },
          ],
        },
        {
          id: 11,
          attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-VERDE' }],
          attribute_combinations: [
            { id: 'COLOR', name: 'Cor', value_name: 'Verde' },
          ],
        },
        {
          id: 12,
          seller_sku: 'SKU-LEGADO-12',
          attributes: [],
          attribute_combinations: [],
        },
        {
          id: 13,
          seller_custom_field: 'NAO-USAR-NA-VARIACAO',
          attributes: [],
          attribute_combinations: [],
        },
      ],
    });

    assert.deepEqual(
      listing.items.map((item) => ({
        id: item.externalSellableId,
        sku: item.sellerSku,
        source: item.sellerSkuSource,
        label: item.variationLabel,
      })),
      [
        {
          id: '10',
          sku: 'SKU-AZUL',
          source: 'variation',
          label: 'Cor: Azul',
        },
        {
          id: '11',
          sku: 'SKU-VERDE',
          source: 'variation',
          label: 'Cor: Verde',
        },
        {
          id: '12',
          sku: 'SKU-LEGADO-12',
          source: 'variation',
          label: null,
        },
        { id: '13', sku: null, source: null, label: null },
      ],
    );
  });

  it('uses only the safe direct legacy fallback for a simple item', () => {
    const listing = normalizeCatalogItem({
      id: 'MLB3',
      seller_sku: 'SKU-LEGADO-ITEM',
      seller_custom_field: 'NAO-USAR',
      attributes: [],
      variations: [],
    });

    assert.equal(listing.items[0]?.sellerSku, 'SKU-LEGADO-ITEM');
    assert.equal(listing.items[0]?.sellerSkuSource, 'item');
  });

  it('leaves sellerSku null when neither SELLER_SKU nor direct fallback exists', () => {
    const listing = normalizeCatalogItem({
      id: 'MLB4',
      seller_custom_field: 'NAO-USAR',
      attributes: [],
    });

    assert.equal(listing.items[0]?.sellerSku, null);
    assert.equal(listing.items[0]?.sellerSkuSource, null);
  });
});

describe('MercadoLivreCatalogSyncService', () => {
  it('is idempotent and never creates Product identities', async () => {
    const database = new FakeDatabase();
    const client = {
      searchSellerItems: async (
        _sellerId: string,
        _account: Pick<MarketplaceAccount, 'id'>,
        scrollId?: string,
      ) =>
        scrollId
          ? { results: [], scroll_id: null }
          : { results: ['MLB2'], scroll_id: 'scroll-1' },
      getItems: async () => [
        {
          id: 'MLB2',
          statusCode: 200,
          body: {
            id: 'MLB2',
            title: 'Camiseta',
            status: 'active',
            attributes: [],
            variations: [
              { id: 10, attributes: [], attribute_combinations: [] },
              { id: 11, attributes: [], attribute_combinations: [] },
            ],
          },
        },
      ],
    };
    const service = new MercadoLivreCatalogSyncService(
      database as unknown as DatabaseService,
      client as unknown as MercadoLivreCatalogClient,
    );

    const first = await service.syncAccount('c1', false);
    const second = await service.syncAccount('c1', false);

    assert.equal(first.summary.created, 1);
    assert.equal(second.summary.created, 0);
    assert.equal(second.summary.updated, 1);
    assert.equal(database.listings.length, 1);
    assert.equal(database.items.length, 2);
    assert.equal(database.productWrites, 0);
    assert.ok(database.items.every((item) => item.productId === null));
    assert.equal(first.summary.skuViaItem, 0);
    assert.equal(first.summary.skuViaVariation, 0);
    assert.equal(first.summary.withoutSkuReal, 2);
  });

  it('reports SKU source, account duplicates and the C1/C2 distribution', () => {
    const service = new MercadoLivreCatalogSyncService(
      new FakeDatabase() as unknown as DatabaseService,
      {} as MercadoLivreCatalogClient,
    );
    const c1Listings = [
      normalizeCatalogItem({
        id: 'C1-SIMPLE',
        attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-COMUM' }],
      }),
      normalizeCatalogItem({
        id: 'C1-VARIATIONS',
        attributes: [{ id: 'SELLER_SKU', value_name: 'NAO-HERDAR' }],
        variations: [
          {
            id: 1,
            attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-DUPLICADO' }],
          },
          {
            id: 2,
            attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-DUPLICADO' }],
          },
          { id: 3, attributes: [] },
        ],
      }),
    ];
    const c2Listings = [
      normalizeCatalogItem({
        id: 'C2-COMMON',
        attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-COMUM' }],
      }),
      normalizeCatalogItem({
        id: 'C2-ONLY',
        attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-C2' }],
      }),
    ];

    const audit = service.buildDryRunAudit([
      auditResult('c1', '740458955', c1Listings, 1),
      auditResult('c2', '1196767962', c2Listings, 0),
    ]);

    assert.deepEqual(audit.skuDistribution, {
      onlyC1: 1,
      onlyC2: 1,
      inBoth: 1,
    });
    assert.deepEqual(audit.skusOnlyC1, ['SKU-DUPLICADO']);
    assert.deepEqual(audit.skusOnlyC2, ['SKU-C2']);
    assert.deepEqual(audit.skusInBoth, ['SKU-COMUM']);
    assert.deepEqual(
      audit.accounts.map((account) => ({
        account: account.account,
        listings: account.listings,
        listingItems: account.listingItems,
        skuViaItem: account.skuViaItem,
        skuViaVariation: account.skuViaVariation,
        withoutSkuReal: account.withoutSkuReal,
        distinctSkus: account.distinctSkus,
        listingsWithVariations: account.listingsWithVariations,
        failures: account.failures,
        duplicateSellerSkus: account.duplicateSellerSkus.length,
      })),
      [
        {
          account: 'c1',
          listings: 3,
          listingItems: 4,
          skuViaItem: 1,
          skuViaVariation: 2,
          withoutSkuReal: 1,
          distinctSkus: 2,
          listingsWithVariations: 1,
          failures: 1,
          duplicateSellerSkus: 1,
        },
        {
          account: 'c2',
          listings: 2,
          listingItems: 2,
          skuViaItem: 2,
          skuViaVariation: 0,
          withoutSkuReal: 0,
          distinctSkus: 2,
          listingsWithVariations: 0,
          failures: 0,
          duplicateSellerSkus: 0,
        },
      ],
    );
    assert.equal(audit.sellerSkuWithMultipleAssociations.length, 2);
  });
});

function auditResult(
  account: 'c1' | 'c2',
  externalAccountId: string,
  listings: NormalizedCatalogListing[],
  failures: number,
): SyncAccountResult {
  const listingItems = listings.reduce(
    (total, listing) => total + listing.items.length,
    0,
  );
  const summary: CatalogSyncSummary = {
    account,
    externalAccountId,
    dryRun: true,
    listingsFound: listings.length + failures,
    listingsProcessed: listings.length,
    created: listings.length,
    updated: 0,
    listingItems,
    skuViaItem: listings.flatMap((listing) => listing.items).filter(
      (item) => item.sellerSkuSource === 'item',
    ).length,
    skuViaVariation: listings.flatMap((listing) => listing.items).filter(
      (item) => item.sellerSkuSource === 'variation',
    ).length,
    withoutSkuReal: listings.flatMap((listing) => listing.items).filter(
      (item) => item.sellerSku === null,
    ).length,
    withVariations: listings.filter((listing) => listing.hasVariations).length,
    failures,
  };
  return { summary, listings };
}

function makeClient(responses: Response[]): {
  client: MercadoLivreCatalogClient;
  calls: Array<{ url: URL; init: RequestInit }>;
} {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  let responseIndex = 0;
  const fetchMock = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const response = responses[responseIndex];
    responseIndex += 1;
    if (!response) throw new Error('Unexpected fetch call in test.');
    return response;
  }) as typeof fetch;
  return {
    client: new MercadoLivreCatalogClient(
      { getAccessToken: () => ACCESS_TOKEN },
      fetchMock,
      1_000,
    ),
    calls,
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface FakeListing {
  id: string;
  marketplaceAccountId: string;
  externalListingId: string;
  title: string | null;
  status: string | null;
}

interface FakeItem {
  id: string;
  marketplaceListingId: string;
  productId: null;
  externalSellableId: string;
  sellerSku: string | null;
  variationLabel: string | null;
  active: boolean;
}

class FakeDatabase {
  readonly listings: FakeListing[] = [];
  readonly items: FakeItem[] = [];
  productWrites = 0;

  readonly marketplaceAccount = {
    findUnique: async () => ACCOUNT,
  };

  readonly marketplaceListing = {
    findMany: async (args: {
      where: { marketplaceAccountId: string; externalListingId: { in: string[] } };
    }) =>
      this.listings.filter(
        (listing) =>
          listing.marketplaceAccountId === args.where.marketplaceAccountId &&
          args.where.externalListingId.in.includes(listing.externalListingId),
      ),
    upsert: async (args: {
      where: {
        marketplaceAccountId_externalListingId: {
          marketplaceAccountId: string;
          externalListingId: string;
        };
      };
      create: Omit<FakeListing, 'id'>;
      update: Pick<FakeListing, 'title' | 'status'>;
    }) => {
      const identity = args.where.marketplaceAccountId_externalListingId;
      let listing = this.listings.find(
        (candidate) =>
          candidate.marketplaceAccountId === identity.marketplaceAccountId &&
          candidate.externalListingId === identity.externalListingId,
      );
      if (!listing) {
        listing = { id: `listing-${this.listings.length + 1}`, ...args.create };
        this.listings.push(listing);
      } else {
        Object.assign(listing, args.update);
      }
      return listing;
    },
  };

  readonly marketplaceListingItem = {
    upsert: async (args: {
      where: {
        marketplaceListingId_externalSellableId: {
          marketplaceListingId: string;
          externalSellableId: string;
        };
      };
      create: Omit<FakeItem, 'id' | 'productId'>;
      update: Pick<FakeItem, 'sellerSku' | 'variationLabel' | 'active'>;
    }) => {
      const identity = args.where.marketplaceListingId_externalSellableId;
      let item = this.items.find(
        (candidate) =>
          candidate.marketplaceListingId === identity.marketplaceListingId &&
          candidate.externalSellableId === identity.externalSellableId,
      );
      if (!item) {
        item = {
          id: `item-${this.items.length + 1}`,
          productId: null,
          ...args.create,
        };
        this.items.push(item);
      } else {
        Object.assign(item, args.update);
      }
      return item;
    },
  };

  async $transaction<T>(callback: (transaction: this) => Promise<T>): Promise<T> {
    return callback(this);
  }
}
