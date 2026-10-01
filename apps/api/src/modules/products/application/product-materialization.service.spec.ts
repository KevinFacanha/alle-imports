import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { ProductIdentityProvider } from '@prisma/client';

import {
  ExistingExternalIdentity,
  ProductMaterializationAnalysis,
  ProductMaterializationApproval,
  ProductMaterializationCandidate,
  ProductMaterializationPlan,
  ProductMaterializationService,
  ProductMaterializationState,
  ProductMaterializationStore,
} from './product-materialization.service.js';

const C1_ID = 'c1000000-0000-4000-8000-000000000001';
const C2_ID = 'c2000000-0000-4000-8000-000000000002';
const C1_MARKETPLACE_ID = '11000000-0000-4000-8000-000000000001';
const C2_MARKETPLACE_ID = '22000000-0000-4000-8000-000000000002';

describe('ProductMaterializationService', () => {
  it('plans one C1 Product with one link and account-scoped ML/Olist identities', async () => {
    const candidate = candidateFixture(1, 'C1', '101');
    const { execution } = await dryRun([candidate]);

    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.listingLinksToCreate, 1);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 1);
    assert.equal(execution.olistIdentitiesToCreate, 1);
    assert.equal(execution.externalIdentitiesToCreate, 2);
    assert.equal(execution.conflicts.length, 0);
    assert.equal(candidate.proposedProductSku, 'PRD-OLIST-C1-101');
  });

  it('plans one C2 Product with Olist identity isolated to C2', async () => {
    const candidate = candidateFixture(2, 'C2', '202');
    const { execution, store } = await dryRun([candidate]);

    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.externalIdentitiesToCreate, 2);
    assert.equal(candidate.listingItems[0]!.businessAccountId, C2_ID);
    assert.equal(store.applyCalls, 0);
  });

  it('plans one shared C1+C2 Product with two links and four identities', async () => {
    const candidate = sharedCandidateFixture(3);
    const { execution } = await dryRun([candidate]);

    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.listingLinksToCreate, 2);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 2);
    assert.equal(execution.olistIdentitiesToCreate, 2);
    assert.equal(execution.approvedTotals.bothAccounts, 1);
    assert.equal(candidate.proposedProductSku, 'PRD-GTIN-7890000000003');
  });

  it('allows repeated sellerSku across distinct Products without using it as Product.sku', async () => {
    const first = candidateFixture(4, 'C1', '404', 'SAME-SKU');
    const second = candidateFixture(5, 'C1', '405', 'SAME-SKU');
    const { execution } = await dryRun([first, second]);

    assert.equal(execution.productsToCreate, 2);
    assert.equal(execution.externalIdentitiesToCreate, 4);
    assert.equal(execution.conflicts.length, 0);
    assert.notEqual(first.proposedProductSku, second.proposedProductSku);
    assert.equal(first.proposedProductSku.includes('SAME-SKU'), false);
  });

  it('is idempotent after a complete authorized service execution', async () => {
    const plan = planFixture([candidateFixture(6, 'C1', '606')]);
    const { contents, approval } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    const service = new ProductMaterializationService(store, approval);

    const first = await service.execute({ planContents: contents, dryRun: false });
    const second = await service.execute({ planContents: contents, dryRun: false });

    assert.equal(first.writesPerformed, 4);
    assert.equal(second.writesPerformed, 0);
    assert.equal(second.productsAlreadyMaterialized, 1);
    assert.equal(second.listingLinksAlreadyCorrect, 1);
    assert.equal(second.externalIdentitiesAlreadyCorrect, 2);
    assert.equal(store.state.products.length, 1);
    assert.equal(store.state.externalIdentities.length, 2);
  });

  it('blocks when a current external identity belongs to another Product', async () => {
    const candidate = candidateFixture(7, 'C1', '707');
    const plan = planFixture([candidate]);
    const { contents, approval } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    store.state.externalIdentities.push(
      externalIdentityFixture(candidate, 'other-product-id'),
    );

    await assert.rejects(
      new ProductMaterializationService(store, approval).execute({
        planContents: contents,
        dryRun: true,
      }),
      new RegExp('belongs to another Product'),
    );
    assert.equal(store.applyCalls, 0);
  });

  it('blocks when a listing item is already linked to a different Product', async () => {
    const candidate = candidateFixture(8, 'C2', '808');
    const plan = planFixture([candidate]);
    const { contents, approval } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    store.state.listingItems[0]!.productId = 'other-product-id';

    await assert.rejects(
      new ProductMaterializationService(store, approval).execute({
        planContents: contents,
        dryRun: true,
      }),
      new RegExp('listing item .* belongs to another Product'),
    );
    assert.equal(store.applyCalls, 0);
  });

  it('performs no writes or transaction in dry-run', async () => {
    const candidate = candidateFixture(9, 'C1', '909');
    const { execution, store } = await dryRun([candidate]);

    assert.equal(execution.mode, 'DRY_RUN');
    assert.equal(execution.writesPerformed, 0);
    assert.equal(store.transactionCalls, 0);
    assert.equal(store.applyCalls, 0);
    assert.equal(store.state.products.length, 0);
    assert.equal(store.state.externalIdentities.length, 0);
    assert.equal(store.state.listingItems[0]!.productId, null);
  });
});

async function dryRun(candidates: ProductMaterializationCandidate[]) {
  const plan = planFixture(candidates);
  const { contents, approval } = approvedContents(plan);
  const store = new FakeMaterializationStore(plan);
  const execution = await new ProductMaterializationService(
    store,
    approval,
  ).execute({ planContents: contents, dryRun: true });
  return { execution, store };
}

function approvedContents(plan: ProductMaterializationPlan): {
  contents: Buffer;
  approval: ProductMaterializationApproval;
} {
  const contents = Buffer.from(JSON.stringify(plan));
  const listingItems = plan.candidates.reduce(
    (total, candidate) => total + candidate.listingItems.length,
    0,
  );
  return {
    contents,
    approval: {
      sha256: createHash('sha256').update(contents).digest('hex'),
      products: plan.candidates.length,
      listingItems,
      mercadoLivreIdentities: listingItems,
      olistIdentities: listingItems,
      externalIdentities: listingItems * 2,
      bothAccounts: plan.candidates.filter(({ accounts }) =>
        accounts.includes('C1') && accounts.includes('C2'),
      ).length,
    },
  };
}

function planFixture(
  candidates: ProductMaterializationCandidate[],
): ProductMaterializationPlan {
  const listingItems = candidates.reduce(
    (total, candidate) => total + candidate.listingItems.length,
    0,
  );
  const bothAccounts = candidates.filter(
    ({ accounts }) => accounts.includes('C1') && accounts.includes('C2'),
  ).length;
  return {
    diagnostic: 'READ_ONLY_MATERIALIZATION_PLAN',
    summary: {
      listingItemsHigh: listingItems,
      productCandidates: candidates.length,
      bothC1AndC2: bothAccounts,
      ready: candidates.length,
      blocked: 0,
      plannedWritesIfLaterAuthorized: {
        Product: candidates.length,
        MarketplaceListingItemProductLinks: listingItems,
        ProductExternalIdentity: listingItems * 2,
        MercadoLivreIdentities: listingItems,
        OlistIdentities: listingItems,
      },
    },
    candidates,
  };
}

function candidateFixture(
  index: number,
  account: 'C1' | 'C2',
  olistProductId: string,
  sellerSku = `SKU-${index}`,
): ProductMaterializationCandidate {
  const item = listingItemFixture(index, account, olistProductId, sellerSku);
  return {
    productCandidateId: `PC-HIGH-${String(index).padStart(3, '0')}`,
    groupKey: `${account}:OLIST:${olistProductId}`,
    evidenceHigh: ['ORDER_PRODUCT_ID'],
    accounts: [account],
    listingItemCount: 1,
    olistProductIds: {
      C1: account === 'C1' ? [olistProductId] : [],
      C2: account === 'C2' ? [olistProductId] : [],
    },
    gtin: null,
    observedSkus: [sellerSku],
    proposedProductSku: `PRD-OLIST-${account}-${olistProductId}`,
    proposedProductName: `Product ${index}`,
    listingItems: [item],
    status: 'READY',
    blockers: [],
  };
}

function sharedCandidateFixture(index: number): ProductMaterializationCandidate {
  const gtin = `7890000000${String(index).padStart(3, '0')}`;
  const c1 = listingItemFixture(index * 10 + 1, 'C1', `${index}01`);
  const c2 = listingItemFixture(index * 10 + 2, 'C2', `${index}02`);
  return {
    productCandidateId: `PC-HIGH-${String(index).padStart(3, '0')}`,
    groupKey: `GTIN:${gtin}`,
    evidenceHigh: ['GTIN_UNIQUE'],
    accounts: ['C1', 'C2'],
    listingItemCount: 2,
    olistProductIds: { C1: [c1.olistProductId], C2: [c2.olistProductId] },
    gtin,
    observedSkus: [c1.sellerSku!, c2.sellerSku!],
    proposedProductSku: `PRD-GTIN-${gtin}`,
    proposedProductName: `Shared product ${index}`,
    listingItems: [c1, c2],
    status: 'READY',
    blockers: [],
  };
}

function listingItemFixture(
  index: number,
  account: 'C1' | 'C2',
  olistProductId: string,
  sellerSku = `SKU-${index}`,
) {
  const serial = String(index).padStart(12, '0');
  const externalListingId = `MLB${100000 + index}`;
  return {
    marketplaceListingItemId: `00000001-0000-4000-8000-${serial}`,
    account,
    businessAccountId: account === 'C1' ? C1_ID : C2_ID,
    marketplaceAccountId:
      account === 'C1' ? C1_MARKETPLACE_ID : C2_MARKETPLACE_ID,
    marketplaceListingId: `00000002-0000-4000-8000-${serial}`,
    externalListingId,
    externalSellableId: externalListingId,
    externalVariationId: null,
    sellerSku,
    olistProductId,
    olistSku: sellerSku,
    evidence: 'ORDER_PRODUCT_ID',
  };
}

function externalIdentityFixture(
  candidate: ProductMaterializationCandidate,
  productId: string,
): ExistingExternalIdentity {
  const item = candidate.listingItems[0]!;
  return {
    id: 'identity-conflict',
    productId,
    businessAccountId: item.businessAccountId,
    provider: ProductIdentityProvider.MERCADO_LIVRE,
    sellerSku: item.sellerSku,
    externalListingId: item.externalListingId,
    externalVariationId: item.externalVariationId,
    marketplaceListingItemId: item.marketplaceListingItemId,
  };
}

class FakeMaterializationStore implements ProductMaterializationStore {
  readonly state: ProductMaterializationState;
  transactionCalls = 0;
  applyCalls = 0;

  constructor(plan: ProductMaterializationPlan) {
    this.state = {
      products: [],
      businessAccounts: [
        { id: C1_ID, code: 'C1' },
        { id: C2_ID, code: 'C2' },
      ],
      listingItems: plan.candidates.flatMap(({ listingItems }) =>
        listingItems.map((item) => ({
          id: item.marketplaceListingItemId,
          productId: null,
          sellerSku: item.sellerSku,
          externalSellableId: item.externalSellableId,
          marketplaceListing: {
            id: item.marketplaceListingId,
            externalListingId: item.externalListingId,
            marketplaceAccountId: item.marketplaceAccountId,
            marketplaceAccount: {
              businessAccountId: item.businessAccountId,
            },
          },
        })),
      ),
      externalIdentities: [],
    };
  }

  async loadState(): Promise<ProductMaterializationState> {
    return structuredClone(this.state);
  }

  async runInTransaction<T>(
    operation: (store: ProductMaterializationStore) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    return operation(this);
  }

  async apply(analysis: ProductMaterializationAnalysis): Promise<number> {
    this.applyCalls += 1;
    const idsBySku = new Map(analysis.existingProductIdsBySku);
    for (const candidate of analysis.plan.candidates) {
      if (!analysis.productSkusToCreate.has(candidate.proposedProductSku)) continue;
      const id = `product-${this.state.products.length + 1}`;
      this.state.products.push({
        id,
        sku: candidate.proposedProductSku,
        name: candidate.proposedProductName,
      });
      idsBySku.set(candidate.proposedProductSku, id);
    }
    for (const [offset, identity] of analysis.identitiesToCreate.entries()) {
      this.state.externalIdentities.push({
        id: `identity-${this.state.externalIdentities.length + offset + 1}`,
        productId: idsBySku.get(identity.candidateSku)!,
        businessAccountId: identity.businessAccountId,
        provider: identity.provider,
        sellerSku: identity.sellerSku,
        externalListingId: identity.externalListingId,
        externalVariationId: identity.externalVariationId,
        marketplaceListingItemId: identity.marketplaceListingItemId,
      });
    }
    for (const listingItemId of analysis.listingItemIdsToLink) {
      const listingItem = this.state.listingItems.find(
        ({ id }) => id === listingItemId,
      )!;
      const candidate = analysis.plan.candidates.find(({ listingItems }) =>
        listingItems.some(
          ({ marketplaceListingItemId }) =>
            marketplaceListingItemId === listingItemId,
        ),
      )!;
      listingItem.productId = idsBySku.get(candidate.proposedProductSku)!;
    }
    return (
      analysis.productSkusToCreate.size +
      analysis.identitiesToCreate.length +
      analysis.listingItemIdsToLink.size
    );
  }
}
