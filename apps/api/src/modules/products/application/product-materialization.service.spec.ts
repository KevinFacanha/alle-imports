import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { ProductIdentityProvider } from '@prisma/client';

import {
  ExistingExternalIdentity,
  ProductMaterializationAnalysis,
  ProductMaterializationCandidate,
  ProductMaterializationPlan,
  PlannedExternalIdentity,
  ProductMaterializationService,
  ProductMaterializationState,
  ProductMaterializationStore,
} from './product-materialization.service.js';

const C1_ID = 'c1000000-0000-4000-8000-000000000001';
const C2_ID = 'c2000000-0000-4000-8000-000000000002';
const C1_MARKETPLACE_ID = '11000000-0000-4000-8000-000000000001';
const C2_MARKETPLACE_ID = '22000000-0000-4000-8000-000000000002';

describe('ProductMaterializationService', () => {
  it('executes one C1 Product with one link and account-scoped ML/Olist identities', async () => {
    const candidate = candidateFixture(1, 'C1', '101');
    const { execution, store } = await authorizedExecution([candidate]);

    assert.equal(execution.mode, 'EXECUTE');
    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.listingLinksToCreate, 1);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 1);
    assert.equal(execution.olistIdentitiesToCreate, 1);
    assert.equal(execution.externalIdentitiesToCreate, 2);
    assert.equal(execution.writesPerformed, 4);
    assert.equal(execution.conflicts.length, 0);
    assert.equal(candidate.proposedProductSku, 'PRD-OLIST-C1-101');
    assert.equal(store.transactionCalls, 1);
    assert.equal(store.state.listingItems[0]!.productId, 'product-1');
  });

  it('executes one C2 Product with Olist identity isolated to C2', async () => {
    const candidate = candidateFixture(2, 'C2', '202');
    const { execution, store } = await authorizedExecution([candidate]);

    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.externalIdentitiesToCreate, 2);
    assert.equal(execution.writesPerformed, 4);
    assert.equal(candidate.listingItems[0]!.businessAccountId, C2_ID);
    assert.equal(store.state.externalIdentities.length, 2);
    assert.ok(
      store.state.externalIdentities.every(
        ({ businessAccountId }) => businessAccountId === C2_ID,
      ),
    );
  });

  it('executes one cross-account C1+C2 Product atomically', async () => {
    const candidate = sharedCandidateFixture(3);
    const { execution, store } = await authorizedExecution([candidate]);

    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.listingLinksToCreate, 2);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 2);
    assert.equal(execution.olistIdentitiesToCreate, 2);
    assert.equal(execution.approvedTotals.bothAccounts, 1);
    assert.equal(execution.writesPerformed, 7);
    assert.equal(candidate.proposedProductSku, 'PRD-GTIN-7890000000003');
    assert.equal(store.transactionCalls, 1);
    assert.equal(new Set(store.state.listingItems.map(({ productId }) => productId)).size, 1);
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
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    const service = new ProductMaterializationService(store);

    const first = await service.execute({ planContents: contents, expectedSha256, execute: true });
    const second = await service.execute({ planContents: contents, expectedSha256, execute: true });

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
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    store.state.externalIdentities.push(
      externalIdentityFixture(candidate, 'other-product-id'),
    );

    await assert.rejects(
      new ProductMaterializationService(store).execute({
        planContents: contents,
        expectedSha256,
        execute: true,
      }),
      new RegExp('belongs to another Product'),
    );
    assert.equal(store.applyCalls, 0);
    assert.equal(store.transactionCalls, 0);
  });

  it('blocks when a listing item is already linked to a different Product', async () => {
    const candidate = candidateFixture(8, 'C2', '808');
    const plan = planFixture([candidate]);
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    store.state.listingItems[0]!.productId = 'other-product-id';

    await assert.rejects(
      new ProductMaterializationService(store).execute({
        planContents: contents,
        expectedSha256,
        execute: true,
      }),
      new RegExp('listing item .* belongs to another Product'),
    );
    assert.equal(store.applyCalls, 0);
    assert.equal(store.transactionCalls, 0);
  });

  it('preflights every selected candidate before the first write', async () => {
    const first = candidateFixture(19, 'C1', '1919');
    const conflicting = candidateFixture(20, 'C2', '2020');
    const plan = planFixture([first, conflicting]);
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    store.state.listingItems[1]!.productId = 'other-product-id';

    await assert.rejects(
      new ProductMaterializationService(store).execute({
        planContents: contents,
        expectedSha256,
        execute: true,
      }),
      /listing item .* belongs to another Product/,
    );
    assert.equal(store.transactionCalls, 0);
    assert.equal(store.applyCalls, 0);
    assert.equal(store.state.products.length, 0);
    assert.equal(store.state.listingItems[0]!.productId, null);
  });

  it('performs zero writes without the explicit execute opt-in', async () => {
    const candidate = candidateFixture(9, 'C1', '909');
    const plan = planFixture([candidate]);
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    const execution = await new ProductMaterializationService(store).execute({ planContents: contents, expectedSha256 });

    assert.equal(execution.mode, 'DRY_RUN');
    assert.equal(execution.writesPerformed, 0);
    assert.equal(store.transactionCalls, 0);
    assert.equal(store.applyCalls, 0);
    assert.equal(store.state.products.length, 0);
    assert.equal(store.state.externalIdentities.length, 0);
    assert.equal(store.state.listingItems[0]!.productId, null);
  });

  it('filters repeated candidate arguments and uses one transaction per Product', async () => {
    const first = candidateFixture(10, 'C1', '1010');
    const second = candidateFixture(11, 'C2', '1111');
    const skipped = candidateFixture(12, 'C1', '1212');
    const plan = planFixture([first, second, skipped]);
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);

    const execution = await new ProductMaterializationService(store).execute({
      planContents: contents,
      expectedSha256,
      execute: true,
      candidateIds: [first.productCandidateId, second.productCandidateId],
    });

    assert.deepEqual(execution.candidateIds, [
      first.productCandidateId,
      second.productCandidateId,
    ]);
    assert.equal(execution.writesPerformed, 8);
    assert.equal(store.transactionCalls, 2);
    assert.equal(store.state.products.length, 2);
    assert.equal(store.state.listingItems[2]!.productId, null);
  });

  it('rejects a candidate that is absent from the approved plan before writing', async () => {
    const plan = planFixture([candidateFixture(13, 'C1', '1313')]);
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);

    await assert.rejects(
      new ProductMaterializationService(store).execute({
        planContents: contents,
        expectedSha256,
        execute: true,
        candidateIds: ['PC-HIGH-999'],
      }),
      /does not exist in the approved plan/,
    );
    assert.equal(store.transactionCalls, 0);
    assert.equal(store.applyCalls, 0);
  });

  it('rejects an incorrect expected SHA-256 before reading state or writing', async () => {
    const plan = planFixture([candidateFixture(14, 'C1', '1414')]);
    const { contents } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);

    await assert.rejects(
      new ProductMaterializationService(store).execute({
        planContents: contents,
        expectedSha256: '0'.repeat(64),
        execute: true,
      }),
      /Plan SHA-256 mismatch/,
    );
    assert.equal(store.loadStateCalls, 0);
    assert.equal(store.transactionCalls, 0);
    assert.equal(store.applyCalls, 0);
  });

  it('creates incremental C1 and C2 Products with isolated identities', async () => {
    const c1 = incrementalCandidateFixture(17, false, 'C1');
    const c2 = incrementalCandidateFixture(18, false, 'C2');
    const plan = incrementalPlanFixture([c1, c2]);
    for (const candidate of plan.candidates) {
      const mlIdentity = candidate.plannedIdentities.find(
        ({ provider }) => provider === ProductIdentityProvider.MERCADO_LIVRE,
      )! as PlannedExternalIdentity & { existingIdentityId?: string | null };
      delete (mlIdentity as unknown as Record<string, unknown>)
        .existingIdentityId;
    }
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);

    const service = new ProductMaterializationService(store);
    const execution = await service.execute({
      planContents: contents,
      expectedSha256,
      execute: true,
    });
    const repeated = await service.execute({
      planContents: contents,
      expectedSha256,
      execute: true,
    });

    assert.equal(execution.productsToCreate, 2);
    assert.equal(execution.productsToReuse, 0);
    assert.equal(execution.listingLinksToCreate, 2);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 2);
    assert.equal(execution.olistIdentitiesToCreate, 2);
    assert.equal(execution.writesPerformed, 8);
    assert.equal(repeated.writesPerformed, 0);
    assert.equal(repeated.productsAlreadyMaterialized, 2);
    assert.equal(repeated.externalIdentitiesAlreadyCorrect, 4);
    assert.equal(store.state.products.length, 2);
  });

  it('reuses exactly the approved HIGH Product and existing Olist identity', async () => {
    const candidate = incrementalCandidateFixture(15, true);
    const plan = incrementalPlanFixture([candidate]);
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    store.state.products.push({
      id: candidate.proposedProductId!,
      sku: candidate.proposedProductSku,
      name: candidate.proposedProductName,
    });
    const olistIdentity = candidate.plannedIdentities.find(
      ({ provider }) => provider === ProductIdentityProvider.OLIST,
    )!;
    store.state.externalIdentities.push({
      id: olistIdentity.existingIdentityId!,
      productId: candidate.proposedProductId!,
      businessAccountId: olistIdentity.businessAccountId,
      provider: olistIdentity.provider,
      sellerSku: olistIdentity.sellerSku,
      externalListingId: olistIdentity.externalListingId,
      externalVariationId: olistIdentity.externalVariationId,
      marketplaceListingItemId: olistIdentity.marketplaceListingItemId,
    });

    const execution = await new ProductMaterializationService(store).execute({
      planContents: contents,
      expectedSha256,
      execute: true,
    });

    assert.equal(execution.productsToCreate, 0);
    assert.equal(execution.productsToReuse, 1);
    assert.equal(execution.productsAlreadyMaterialized, 1);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 1);
    assert.equal(execution.olistIdentitiesToCreate, 0);
    assert.equal(execution.olistIdentitiesAlreadyCorrect, 1);
    assert.equal(execution.writesPerformed, 2);
    assert.equal(store.state.products.length, 1);
  });

  it('keeps the historical HIGH plan contract working', async () => {
    const candidate = candidateFixture(16, 'C2', '1616');
    const { execution } = await dryRun([candidate]);

    assert.equal(execution.mode, 'DRY_RUN');
    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.productsToReuse, 0);
    assert.equal(execution.externalIdentitiesToCreate, 2);
  });

  it('dry-runs grouped deterministic item-order evidence with one Olist identity', async () => {
    const first = listingItemFixture(19, 'C1', '9191', '1215');
    const second = listingItemFixture(20, 'C1', '9191', '1215');
    const withEvidence = (item: typeof first, index: number) => ({
      ...item,
      candidateId: `PC-HIGH-ITEM-${index}`,
      correlatedOrderCount: 2,
      conflictingOrderCount: 0,
      ordersUsed: [1, 2].map((order) => ({
        mlOrderId: `ml-${index}-${order}`,
        olistOrderId: `olist-${index}-${order}`,
        olistProductId: item.olistProductId,
      })),
    });
    const proposedProductSku = 'PRD-OLIST-C1-9191';
    const candidate = {
      productCandidateId: 'PC-HIGH-OLIST-C1-9191',
      classification: 'DETERMINISTIC_HIGH' as const,
      action: 'CREATE_PRODUCT_AND_LINK' as const,
      groupKey: 'C1:OLIST:9191',
      identityBasis:
        'EXACT_ITEM_TO_ITEM_ORDER_CORRELATION_TO_SINGLE_OLIST_PRODUCT_ID',
      evidenceHigh: ['ORDER_PRODUCT_ID'],
      accounts: ['C1'],
      listingItemCount: 2,
      olistProductIds: { C1: ['9191'] },
      gtin: null,
      observedSkus: ['1215'],
      proposedProductSku,
      proposedProductName: 'Grouped product',
      proposedProductId: null,
      listingItems: [withEvidence(first, 1), withEvidence(second, 2)],
      plannedIdentities: [
        ...[first, second].map((item) => ({
          candidateSku: proposedProductSku,
          businessAccountId: item.businessAccountId,
          provider: ProductIdentityProvider.MERCADO_LIVRE,
          sellerSku: item.sellerSku,
          externalListingId: item.externalListingId,
          externalVariationId: item.externalVariationId,
          marketplaceListingItemId: item.marketplaceListingItemId,
          action: 'CREATE' as const,
          existingIdentityId: null,
        })),
        {
          candidateSku: proposedProductSku,
          businessAccountId: first.businessAccountId,
          provider: ProductIdentityProvider.OLIST,
          sellerSku: first.olistSku,
          externalListingId: first.olistProductId,
          externalVariationId: null,
          marketplaceListingItemId: null,
          action: 'CREATE' as const,
          existingIdentityId: null,
        },
      ],
      status: 'READY',
      blockers: [],
    };
    const plan = {
      diagnostic: 'READ_ONLY_ITEM_ORDER_CORRELATION_MATERIALIZATION_PLAN',
      version: 1,
      sourceAudit: {
        classification: 'DETERMINISTIC_HIGH',
        reportPath: 'audit.md',
        repositoryCommit: '0123456789abcdef',
        rule: {
          exactMarketplaceOrderCorrelation: true,
          singleMlAndOlistLinePerEvidenceOrder: true,
          minimumIndependentCorrelatedOrders: 2,
          singleOlistProductIdPerListing: true,
          divergentEvidenceAllowed: 0,
          titleOrFuzzyIdentityAllowed: false,
          sellerSkuAsGlobalIdentityAllowed: false,
        },
      },
      summary: {
        listingItemsHigh: 2,
        productCandidates: 1,
        bothC1AndC2: 0,
        productsToCreate: 1,
        productsToReuse: 0,
        ready: 1,
        blocked: 0,
        plannedWritesIfLaterAuthorized: {
          Product: 1,
          MarketplaceListingItemProductLinks: 2,
          ProductExternalIdentity: 3,
          MercadoLivreIdentities: 2,
          OlistIdentities: 1,
        },
      },
      candidates: [candidate],
    } as ProductMaterializationPlan & Record<string, unknown>;
    const { contents, expectedSha256 } = approvedContents(plan);
    const store = new FakeMaterializationStore(plan);
    const execution = await new ProductMaterializationService(store).execute({
      planContents: contents,
      expectedSha256,
    });

    assert.equal(execution.productsToCreate, 1);
    assert.equal(execution.listingLinksToCreate, 2);
    assert.equal(execution.mercadoLivreIdentitiesToCreate, 2);
    assert.equal(execution.olistIdentitiesToCreate, 1);
    assert.deepEqual(execution.conflicts, []);
    assert.equal(execution.writesPerformed, 0);
  });

});

function incrementalCandidateFixture(
  index: number,
  reuse: boolean,
  account: 'C1' | 'C2' = 'C1',
): ProductMaterializationCandidate & Record<string, unknown> {
  const base = candidateFixture(index, account, `${9000 + index}`);
  const productId = reuse
    ? `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, '0')}`
    : null;
  const [item] = base.listingItems;
  item!.evidence = 'OLIST_SKU_EXACT_UNIQUE_PLUS_MULTIPLE_PAID_ORDERS';
  const plannedIdentities: PlannedExternalIdentity[] = [
    {
      candidateSku: base.proposedProductSku,
      businessAccountId: item!.businessAccountId,
      provider: ProductIdentityProvider.MERCADO_LIVRE,
      sellerSku: item!.sellerSku,
      externalListingId: item!.externalListingId,
      externalVariationId: item!.externalVariationId,
      marketplaceListingItemId: item!.marketplaceListingItemId,
      action: 'CREATE',
      existingIdentityId: null,
    },
    {
      candidateSku: base.proposedProductSku,
      businessAccountId: item!.businessAccountId,
      provider: ProductIdentityProvider.OLIST,
      sellerSku: item!.olistSku,
      externalListingId: item!.olistProductId,
      externalVariationId: null,
      marketplaceListingItemId: null,
      action: reuse ? 'ALREADY_CORRECT' : 'CREATE',
      existingIdentityId: reuse
        ? `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, '0')}`
        : null,
    },
  ];
  return {
    ...base,
    classification: 'PROMOTABLE_TO_HIGH',
    action: reuse
      ? 'REUSE_HIGH_PRODUCT_AND_LINK'
      : 'CREATE_PRODUCT_AND_LINK',
    evidenceHigh: [
      'OLIST_SKU_EXACT_UNIQUE',
      'PAID_ORDER_SELLER_SKU_CORROBORATION',
    ],
    proposedProductId: productId,
    plannedIdentities,
    identityBasis:
      'EXACT_ACCOUNT_SCOPED_OLIST_MATCH_CORROBORATED_BY_MULTIPLE_PAID_ORDERS',
    auditEvidence: {
      exactOlistMatchesInAccount: 1,
      unlinkedListingItemsWithSkuInAccount: 1,
      paidOrderCount: 2,
      paidUnits: 2,
      paidOrderIds: ['order-1', 'order-2'],
      sellerSkuConsistentInAllPaidOrders: true,
      divergentEvidenceCount: 0,
    },
  };
}

function incrementalPlanFixture(
  candidates: Array<ProductMaterializationCandidate & Record<string, unknown>>,
): ProductMaterializationPlan & Record<string, unknown> {
  const creates = candidates.filter(
    ({ action }) => action === 'CREATE_PRODUCT_AND_LINK',
  ).length;
  const identities = candidates.flatMap(({ plannedIdentities }) =>
    plannedIdentities,
  );
  return {
    diagnostic: 'READ_ONLY_INCREMENTAL_MATERIALIZATION_PLAN',
    version: 1,
    sourceAudit: {
      classification: 'PROMOTABLE_TO_HIGH',
      repositoryCommit: '0123456789abcdef',
      checkpoint: 'checkpoint.json',
      window: {
        from: '2026-08-30T00:00:00.000Z',
        to: '2026-09-29T00:00:00.000Z',
        days: 30,
      },
      rule: {
        accountScopedUnlinkedSellerSkuUnique: true,
        exactUniqueOlistCatalogMatch: true,
        minimumIndependentPaidOrders: 2,
        sellerSkuConsistentInAllPaidOrders: true,
        divergentEvidenceAllowed: 0,
      },
    },
    summary: {
      listingItemsHigh: candidates.length,
      productCandidates: candidates.length,
      bothC1AndC2: 0,
      productsToCreate: creates,
      productsToReuse: candidates.length - creates,
      ready: candidates.length,
      blocked: 0,
      plannedWritesIfLaterAuthorized: {
        Product: creates,
        MarketplaceListingItemProductLinks: candidates.length,
        ProductExternalIdentity: identities.filter(
          ({ action }) => action === 'CREATE',
        ).length,
        MercadoLivreIdentities: identities.filter(
          ({ action, provider }) =>
            action === 'CREATE' &&
            provider === ProductIdentityProvider.MERCADO_LIVRE,
        ).length,
        OlistIdentities: identities.filter(
          ({ action, provider }) =>
            action === 'CREATE' && provider === ProductIdentityProvider.OLIST,
        ).length,
      },
    },
    candidates,
  };
}

async function dryRun(candidates: ProductMaterializationCandidate[]) {
  const plan = planFixture(candidates);
  const { contents, expectedSha256 } = approvedContents(plan);
  const store = new FakeMaterializationStore(plan);
  const execution = await new ProductMaterializationService(store).execute({ planContents: contents, expectedSha256 });
  return { execution, store };
}

async function authorizedExecution(candidates: ProductMaterializationCandidate[]) {
  const plan = planFixture(candidates);
  const { contents, expectedSha256 } = approvedContents(plan);
  const store = new FakeMaterializationStore(plan);
  const execution = await new ProductMaterializationService(store).execute({ planContents: contents, expectedSha256, execute: true });
  return { execution, store };
}

function approvedContents(plan: ProductMaterializationPlan): {
  contents: Buffer;
  expectedSha256: string;
} {
  const contents = Buffer.from(JSON.stringify(plan));
  return {
    contents,
    expectedSha256: createHash('sha256').update(contents).digest('hex'),
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
      productsToCreate: candidates.length,
      productsToReuse: 0,
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
    classification: 'HIGH',
    action: 'CREATE_PRODUCT_AND_LINK',
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
    proposedProductId: null,
    listingItems: [item],
    plannedIdentities: [],
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
    classification: 'HIGH',
    action: 'CREATE_PRODUCT_AND_LINK',
    groupKey: `GTIN:${gtin}`,
    evidenceHigh: ['GTIN_UNIQUE'],
    accounts: ['C1', 'C2'],
    listingItemCount: 2,
    olistProductIds: { C1: [c1.olistProductId], C2: [c2.olistProductId] },
    gtin,
    observedSkus: [c1.sellerSku!, c2.sellerSku!],
    proposedProductSku: `PRD-GTIN-${gtin}`,
    proposedProductName: `Shared product ${index}`,
    proposedProductId: null,
    listingItems: [c1, c2],
    plannedIdentities: [],
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
  loadStateCalls = 0;

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
    this.loadStateCalls += 1;
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
