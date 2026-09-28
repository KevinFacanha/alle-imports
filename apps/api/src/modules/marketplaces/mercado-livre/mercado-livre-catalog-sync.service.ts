import { Injectable } from '@nestjs/common';
import { Marketplace, MarketplaceAccount } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import { MercadoLivreCatalogClient } from './mercado-livre-catalog.client.js';
import {
  MercadoLivreCatalogAttribute,
  MercadoLivreCatalogItem,
  MercadoLivreCatalogVariation,
} from './mercado-livre-catalog.types.js';

const ACCOUNT_EXTERNAL_IDS = {
  c1: '740458955',
  c2: '1196767962',
} as const;
const BULK_SIZE = 20;
const MAX_SCAN_PAGES = 10_000;

export type CatalogAccountAlias = keyof typeof ACCOUNT_EXTERNAL_IDS;

export interface CatalogSyncProgress {
  account: CatalogAccountAlias;
  listingsFound: number;
  listingsProcessed: number;
  created: number;
  updated: number;
  listingItems: number;
  skuViaItem: number;
  skuViaVariation: number;
  withoutSkuReal: number;
  withVariations: number;
  failures: number;
}

export interface CatalogSyncSummary extends CatalogSyncProgress {
  externalAccountId: string;
  dryRun: boolean;
}

export interface CatalogSkuAssociation {
  account: CatalogAccountAlias;
  externalListingId: string;
  externalSellableId: string;
}

export interface CatalogAccountAudit {
  account: CatalogAccountAlias;
  externalAccountId: string;
  listings: number;
  listingItems: number;
  skuViaItem: number;
  skuViaVariation: number;
  distinctSkus: number;
  withoutSkuReal: number;
  listingsWithVariations: number;
  listingsWithoutVariations: number;
  failures: number;
  duplicateSellerSkus: Array<{
    sellerSku: string;
    occurrences: number;
    associations: CatalogSkuAssociation[];
  }>;
}

export interface CatalogAudit {
  accounts: CatalogAccountAudit[];
  skuDistribution: {
    onlyC1: number;
    onlyC2: number;
    inBoth: number;
  };
  skusOnlyC1: string[];
  skusOnlyC2: string[];
  skusInBoth: string[];
  sellerSkuWithMultipleAssociations: Array<{
    sellerSku: string;
    associations: CatalogSkuAssociation[];
  }>;
}

export interface NormalizedCatalogListing {
  externalListingId: string;
  title: string | null;
  status: string | null;
  hasVariations: boolean;
  items: Array<{
    externalSellableId: string;
    sellerSku: string | null;
    sellerSkuSource: 'item' | 'variation' | null;
    variationLabel: string | null;
    active: boolean;
  }>;
}

export interface SyncAccountResult {
  summary: CatalogSyncSummary;
  listings: NormalizedCatalogListing[];
}

@Injectable()
export class MercadoLivreCatalogSyncService {
  constructor(
    private readonly database: DatabaseService,
    private readonly client: MercadoLivreCatalogClient,
  ) {}

  async syncAccount(
    alias: CatalogAccountAlias,
    dryRun: boolean,
    onProgress?: (progress: CatalogSyncProgress) => void,
  ): Promise<SyncAccountResult> {
    const account = await this.loadAccount(alias);
    const itemIds = await this.listAllItemIds(account);
    const progress: CatalogSyncProgress = {
      account: alias,
      listingsFound: itemIds.length,
      listingsProcessed: 0,
      created: 0,
      updated: 0,
      listingItems: 0,
      skuViaItem: 0,
      skuViaVariation: 0,
      withoutSkuReal: 0,
      withVariations: 0,
      failures: 0,
    };
    onProgress?.({ ...progress });

    const allListings: NormalizedCatalogListing[] = [];
    for (const itemIdBatch of chunks(itemIds, BULK_SIZE)) {
      const results = await this.client.getItems(itemIdBatch, account);
      const resultById = new Map(results.map((result) => [result.id, result]));
      const listings: NormalizedCatalogListing[] = [];

      for (const itemId of itemIdBatch) {
        const result = resultById.get(itemId);
        if (!result || result.statusCode !== 200 || !result.body || result.body.id !== itemId) {
          progress.failures += 1;
          continue;
        }
        listings.push(normalizeCatalogItem(result.body));
      }

      const changes = dryRun
        ? await this.classifyBatch(account.id, listings)
        : await this.persistBatch(account.id, listings);
      progress.created += changes.created;
      progress.updated += changes.updated;
      progress.listingsProcessed += listings.length;
      progress.listingItems += listings.reduce(
        (total, listing) => total + listing.items.length,
        0,
      );
      progress.skuViaItem += countSkuSource(listings, 'item');
      progress.skuViaVariation += countSkuSource(listings, 'variation');
      progress.withoutSkuReal += listings.reduce(
        (total, listing) =>
          total + listing.items.filter((item) => item.sellerSku === null).length,
        0,
      );
      progress.withVariations += listings.filter(
        (listing) => listing.hasVariations,
      ).length;
      allListings.push(...listings);
      onProgress?.({ ...progress });
    }

    return {
      summary: {
        ...progress,
        externalAccountId: account.externalAccountId,
        dryRun,
      },
      listings: allListings,
    };
  }

  buildDryRunAudit(results: SyncAccountResult[]): CatalogAudit {
    return buildCatalogAudit(
      results.map((result) => ({
        alias: result.summary.account,
        externalAccountId: result.summary.externalAccountId,
        listingsFound: result.summary.listingsFound,
        failures: result.summary.failures,
        listings: result.listings,
      })),
    );
  }

  async auditPersistedCatalog(
    aliases: CatalogAccountAlias[],
  ): Promise<CatalogAudit> {
    const inputs: AuditInput[] = [];
    for (const alias of aliases) {
      const account = await this.loadAccount(alias);
      const rows = await this.database.marketplaceListing.findMany({
        where: { marketplaceAccountId: account.id },
        orderBy: { externalListingId: 'asc' },
        include: {
          items: {
            orderBy: { externalSellableId: 'asc' },
          },
        },
      });
      inputs.push({
        alias,
        externalAccountId: account.externalAccountId,
        listingsFound: rows.length,
        failures: 0,
        listings: rows.map((listing) => ({
          externalListingId: listing.externalListingId,
          title: listing.title,
          status: listing.status,
          hasVariations: listing.items.some(
            (item) => item.externalSellableId !== listing.externalListingId,
          ),
          items: listing.items.map((item) => ({
            externalSellableId: item.externalSellableId,
            sellerSku: item.sellerSku,
            sellerSkuSource:
              item.sellerSku === null
                ? null
                : item.externalSellableId === listing.externalListingId
                  ? 'item'
                  : 'variation',
            variationLabel: item.variationLabel,
            active: item.active,
          })),
        })),
      });
    }
    return buildCatalogAudit(inputs);
  }

  private async loadAccount(
    alias: CatalogAccountAlias,
  ): Promise<MarketplaceAccount> {
    const externalAccountId = ACCOUNT_EXTERNAL_IDS[alias];
    const account = await this.database.marketplaceAccount.findUnique({
      where: {
        marketplace_externalAccountId: {
          marketplace: Marketplace.MERCADO_LIVRE,
          externalAccountId,
        },
      },
    });
    if (!account) {
      throw new Error(
        `Mercado Livre marketplace account ${alias.toUpperCase()} was not found.`,
      );
    }
    return account;
  }

  private async listAllItemIds(
    account: MarketplaceAccount,
  ): Promise<string[]> {
    const itemIds: string[] = [];
    const seenItemIds = new Set<string>();
    let scrollId: string | undefined;

    for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
      const response = await this.client.searchSellerItems(
        account.externalAccountId,
        account,
        scrollId,
      );
      const results = response.results ?? [];
      if (results.length === 0) return itemIds;

      let newItems = 0;
      for (const itemId of results) {
        if (!seenItemIds.has(itemId)) {
          seenItemIds.add(itemId);
          itemIds.push(itemId);
          newItems += 1;
        }
      }
      if (newItems === 0) {
        throw new Error(
          'Mercado Livre catalog scan repeated a page without new items.',
        );
      }
      if (!response.scroll_id) {
        throw new Error(
          'Mercado Livre catalog scan omitted scroll_id before the final page.',
        );
      }
      scrollId = response.scroll_id;
    }

    throw new Error('Mercado Livre catalog scan exceeded the safe page limit.');
  }

  private async classifyBatch(
    marketplaceAccountId: string,
    listings: NormalizedCatalogListing[],
  ): Promise<{ created: number; updated: number }> {
    if (listings.length === 0) return { created: 0, updated: 0 };
    const existing = await this.database.marketplaceListing.findMany({
      where: {
        marketplaceAccountId,
        externalListingId: {
          in: listings.map((listing) => listing.externalListingId),
        },
      },
      select: { externalListingId: true },
    });
    const existingIds = new Set(
      existing.map((listing) => listing.externalListingId),
    );
    const created = listings.filter(
      (listing) => !existingIds.has(listing.externalListingId),
    ).length;
    return { created, updated: listings.length - created };
  }

  private async persistBatch(
    marketplaceAccountId: string,
    listings: NormalizedCatalogListing[],
  ): Promise<{ created: number; updated: number }> {
    if (listings.length === 0) return { created: 0, updated: 0 };

    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.marketplaceListing.findMany({
        where: {
          marketplaceAccountId,
          externalListingId: {
            in: listings.map((listing) => listing.externalListingId),
          },
        },
        select: { externalListingId: true },
      });
      const existingIds = new Set(
        existing.map((listing) => listing.externalListingId),
      );

      for (const listing of listings) {
        const persistedListing = await transaction.marketplaceListing.upsert({
          where: {
            marketplaceAccountId_externalListingId: {
              marketplaceAccountId,
              externalListingId: listing.externalListingId,
            },
          },
          create: {
            marketplaceAccountId,
            externalListingId: listing.externalListingId,
            title: listing.title,
            status: listing.status,
          },
          update: {
            title: listing.title,
            status: listing.status,
          },
        });

        for (const item of listing.items) {
          await transaction.marketplaceListingItem.upsert({
            where: {
              marketplaceListingId_externalSellableId: {
                marketplaceListingId: persistedListing.id,
                externalSellableId: item.externalSellableId,
              },
            },
            create: {
              marketplaceListingId: persistedListing.id,
              externalSellableId: item.externalSellableId,
              sellerSku: item.sellerSku,
              variationLabel: item.variationLabel,
              active: item.active,
            },
            update: {
              sellerSku: item.sellerSku,
              variationLabel: item.variationLabel,
              active: item.active,
            },
          });
        }
      }

      const created = listings.filter(
        (listing) => !existingIds.has(listing.externalListingId),
      ).length;
      return { created, updated: listings.length - created };
    });
  }
}

export function normalizeCatalogItem(
  item: MercadoLivreCatalogItem,
): NormalizedCatalogListing {
  const variations = item.variations ?? [];
  const active = item.status === 'active';
  const itemSku = sellerSku(item.attributes, item.seller_sku);

  return {
    externalListingId: item.id,
    title: nullableText(item.title),
    status: nullableText(item.status),
    hasVariations: variations.length > 0,
    items:
      variations.length > 0
        ? variations.map((variation) =>
            normalizeCatalogVariation(variation, active),
          )
        : [
            {
              externalSellableId: item.id,
              sellerSku: itemSku,
              sellerSkuSource: itemSku === null ? null : 'item',
              variationLabel: null,
              active,
            },
          ],
  };
}

interface AuditInput {
  alias: CatalogAccountAlias;
  externalAccountId: string;
  listingsFound: number;
  failures: number;
  listings: NormalizedCatalogListing[];
}

function buildCatalogAudit(inputs: AuditInput[]): CatalogAudit {
  const associationsBySku = new Map<string, CatalogSkuAssociation[]>();
  const skuSets = new Map<CatalogAccountAlias, Set<string>>();
  const accounts = inputs.map((input): CatalogAccountAudit => {
    const accountAssociations = new Map<string, CatalogSkuAssociation[]>();
    let listingItems = 0;
    let skuViaItem = 0;
    let skuViaVariation = 0;
    let withoutSkuReal = 0;

    for (const listing of input.listings) {
      listingItems += listing.items.length;
      for (const item of listing.items) {
        if (item.sellerSku === null) {
          withoutSkuReal += 1;
          continue;
        }
        if (item.sellerSkuSource === 'item') skuViaItem += 1;
        if (item.sellerSkuSource === 'variation') skuViaVariation += 1;
        const association: CatalogSkuAssociation = {
          account: input.alias,
          externalListingId: listing.externalListingId,
          externalSellableId: item.externalSellableId,
        };
        appendAssociation(accountAssociations, item.sellerSku, association);
        appendAssociation(associationsBySku, item.sellerSku, association);
      }
    }
    skuSets.set(input.alias, new Set(accountAssociations.keys()));

    return {
      account: input.alias,
      externalAccountId: input.externalAccountId,
      listings: input.listingsFound,
      listingItems,
      skuViaItem,
      skuViaVariation,
      distinctSkus: accountAssociations.size,
      withoutSkuReal,
      listingsWithVariations: input.listings.filter(
        (listing) => listing.hasVariations,
      ).length,
      listingsWithoutVariations: input.listings.filter(
        (listing) => !listing.hasVariations,
      ).length,
      failures: input.failures,
      duplicateSellerSkus: [...accountAssociations.entries()]
        .filter(([, associations]) => associations.length > 1)
        .map(([sellerSkuValue, associations]) => ({
          sellerSku: sellerSkuValue,
          occurrences: associations.length,
          associations,
        }))
        .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku)),
    };
  });

  const c1Skus = skuSets.get('c1') ?? new Set<string>();
  const c2Skus = skuSets.get('c2') ?? new Set<string>();
  const skusOnlyC1 = sortedDifference(c1Skus, c2Skus);
  const skusOnlyC2 = sortedDifference(c2Skus, c1Skus);
  const skusInBoth = [...c1Skus]
    .filter((sku) => c2Skus.has(sku))
    .sort((left, right) => left.localeCompare(right));
  return {
    accounts,
    skuDistribution: {
      onlyC1: skusOnlyC1.length,
      onlyC2: skusOnlyC2.length,
      inBoth: skusInBoth.length,
    },
    skusOnlyC1,
    skusOnlyC2,
    skusInBoth,
    sellerSkuWithMultipleAssociations: [...associationsBySku.entries()]
      .filter(([, associations]) => associations.length > 1)
      .map(([sellerSkuValue, associations]) => ({
        sellerSku: sellerSkuValue,
        associations,
      }))
      .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku)),
  };
}

function sellerSku(
  attributes: MercadoLivreCatalogAttribute[] | undefined,
  directValue: string | null | undefined,
): string | null {
  const attribute = attributes?.find(
    (candidate) => candidate.id?.toUpperCase() === 'SELLER_SKU',
  );
  return nullableText(attribute?.value_name) ?? nullableText(directValue);
}

function normalizeCatalogVariation(
  variation: MercadoLivreCatalogVariation,
  active: boolean,
): NormalizedCatalogListing['items'][number] {
  const variationSku = sellerSku(
    variation.attributes,
    variation.seller_sku,
  );
  return {
    externalSellableId: String(variation.id),
    sellerSku: variationSku,
    sellerSkuSource: variationSku === null ? null : 'variation',
    variationLabel: variationLabel(variation),
    active,
  };
}

function variationLabel(variation: MercadoLivreCatalogVariation): string | null {
  const parts = (variation.attribute_combinations ?? [])
    .map((attribute) => {
      const value = nullableText(attribute.value_name);
      if (!value) return null;
      const name = nullableText(attribute.name);
      return name ? `${name}: ${value}` : value;
    })
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function nullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function appendAssociation(
  map: Map<string, CatalogSkuAssociation[]>,
  sku: string,
  association: CatalogSkuAssociation,
): void {
  const current = map.get(sku);
  if (current) current.push(association);
  else map.set(sku, [association]);
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left]
    .filter((value) => !right.has(value))
    .sort((first, second) => first.localeCompare(second));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function countSkuSource(
  listings: NormalizedCatalogListing[],
  source: 'item' | 'variation',
): number {
  return listings.reduce(
    (listingTotal, listing) =>
      listingTotal +
      listing.items.filter((item) => item.sellerSkuSource === source).length,
    0,
  );
}

