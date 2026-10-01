import { Prisma, ProductIdentityProvider } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import {
  ProductMaterializationAnalysis,
  ProductMaterializationError,
  ProductMaterializationPlan,
  ProductMaterializationState,
  ProductMaterializationStore,
} from '../application/product-materialization.service.js';

type MaterializationClient = Pick<
  Prisma.TransactionClient,
  | 'product'
  | 'businessAccount'
  | 'marketplaceListingItem'
  | 'productExternalIdentity'
>;

export class PrismaProductMaterializationStore
  implements ProductMaterializationStore
{
  constructor(
    private readonly database: DatabaseService,
    private readonly client: MaterializationClient = database,
  ) {}

  async loadState(
    plan: ProductMaterializationPlan,
  ): Promise<ProductMaterializationState> {
    const productSkus = plan.candidates.map(
      ({ proposedProductSku }) => proposedProductSku,
    );
    const proposedProductIds = plan.candidates.flatMap(
      ({ proposedProductId }) =>
        proposedProductId === null ? [] : [proposedProductId],
    );
    const plannedExistingIdentityIds = plan.candidates.flatMap(
      ({ plannedIdentities }) =>
        plannedIdentities.flatMap(({ existingIdentityId }) =>
          existingIdentityId === null ? [] : [existingIdentityId],
        ),
    );
    const businessAccountIds = [
      ...new Set(
        plan.candidates.flatMap(({ listingItems }) =>
          listingItems.map(({ businessAccountId }) => businessAccountId),
        ),
      ),
    ];
    const listingItemIds = plan.candidates.flatMap(({ listingItems }) =>
      listingItems.map(
        ({ marketplaceListingItemId }) => marketplaceListingItemId,
      ),
    );

    const [products, businessAccounts, listingItems] = await Promise.all([
      this.client.product.findMany({
        where: {
          OR: [
            { sku: { in: productSkus } },
            { id: { in: proposedProductIds } },
          ],
        },
        select: { id: true, sku: true, name: true },
      }),
      this.client.businessAccount.findMany({
        where: { id: { in: businessAccountIds } },
        select: { id: true, code: true },
      }),
      this.client.marketplaceListingItem.findMany({
        where: { id: { in: listingItemIds } },
        select: {
          id: true,
          productId: true,
          sellerSku: true,
          externalSellableId: true,
          marketplaceListing: {
            select: {
              id: true,
              externalListingId: true,
              marketplaceAccountId: true,
              marketplaceAccount: {
                select: { businessAccountId: true },
              },
            },
          },
        },
      }),
    ]);

    const sellableKeys: Prisma.ProductExternalIdentityWhereInput[] = [];
    for (const candidate of plan.candidates) {
      for (const item of candidate.listingItems) {
        sellableKeys.push(
          {
            businessAccountId: item.businessAccountId,
            provider: ProductIdentityProvider.MERCADO_LIVRE,
            externalListingId: item.externalListingId,
            externalVariationId: item.externalVariationId,
          },
          {
            businessAccountId: item.businessAccountId,
            provider: ProductIdentityProvider.OLIST,
            externalListingId: item.olistProductId,
            externalVariationId: null,
          },
        );
      }
    }
    const identityScopes: Prisma.ProductExternalIdentityWhereInput[] = [
      ...sellableKeys,
      { marketplaceListingItemId: { in: listingItemIds } },
      { id: { in: plannedExistingIdentityIds } },
    ];
    if (products.length > 0) {
      identityScopes.push({ productId: { in: products.map(({ id }) => id) } });
    }
    const externalIdentities =
      await this.client.productExternalIdentity.findMany({
        where: { validTo: null, OR: identityScopes },
        select: {
          id: true,
          productId: true,
          businessAccountId: true,
          provider: true,
          sellerSku: true,
          externalListingId: true,
          externalVariationId: true,
          marketplaceListingItemId: true,
        },
      });

    return { products, businessAccounts, listingItems, externalIdentities };
  }

  async runInTransaction<T>(
    operation: (store: ProductMaterializationStore) => Promise<T>,
  ): Promise<T> {
    if (this.client !== this.database) {
      throw new ProductMaterializationError(
        'Nested product materialization transactions are not supported.',
      );
    }
    return this.database.$transaction(
      (transaction) =>
        operation(
          new PrismaProductMaterializationStore(this.database, transaction),
        ),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  async apply(analysis: ProductMaterializationAnalysis): Promise<number> {
    if (this.client === this.database) {
      throw new ProductMaterializationError(
        'Product materialization writes require an active transaction.',
      );
    }
    const productIdsBySku = new Map(analysis.existingProductIdsBySku);
    let writes = 0;
    for (const candidate of analysis.plan.candidates) {
      if (!analysis.productSkusToCreate.has(candidate.proposedProductSku)) {
        continue;
      }
      const product = await this.client.product.create({
        data: {
          sku: candidate.proposedProductSku,
          name: candidate.proposedProductName,
        },
        select: { id: true },
      });
      productIdsBySku.set(candidate.proposedProductSku, product.id);
      writes += 1;
    }

    for (const identity of analysis.identitiesToCreate) {
      const productId = productIdsBySku.get(identity.candidateSku);
      if (!productId) {
        throw new ProductMaterializationError(
          `No Product id resolved for ${identity.candidateSku}.`,
        );
      }
      await this.client.productExternalIdentity.create({
        data: {
          productId,
          businessAccountId: identity.businessAccountId,
          provider: identity.provider,
          sellerSku: identity.sellerSku,
          externalListingId: identity.externalListingId,
          externalVariationId: identity.externalVariationId,
          marketplaceListingItemId: identity.marketplaceListingItemId,
        },
      });
      writes += 1;
    }

    for (const listingItemId of analysis.listingItemIdsToLink) {
      const candidate = analysis.plan.candidates.find(({ listingItems }) =>
        listingItems.some(
          ({ marketplaceListingItemId }) =>
            marketplaceListingItemId === listingItemId,
        ),
      );
      const productId = candidate
        ? productIdsBySku.get(candidate.proposedProductSku)
        : undefined;
      if (!productId) {
        throw new ProductMaterializationError(
          `No Product id resolved for listing item ${listingItemId}.`,
        );
      }
      const result = await this.client.marketplaceListingItem.updateMany({
        where: { id: listingItemId, productId: null },
        data: { productId },
      });
      if (result.count !== 1) {
        throw new ProductMaterializationError(
          `Listing item ${listingItemId} changed during materialization.`,
        );
      }
      writes += 1;
    }
    return writes;
  }
}
