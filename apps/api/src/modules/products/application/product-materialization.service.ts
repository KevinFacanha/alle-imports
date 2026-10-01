import { createHash } from 'node:crypto';

import { ProductIdentityProvider } from '@prisma/client';

export const APPROVED_PRODUCT_MATERIALIZATION = {
  sha256: 'dfb0e0b78374aa3b9345f7d6838fbff3e5fde7a5157cc45399a44f209d1ff499',
  products: 110,
  listingItems: 116,
  mercadoLivreIdentities: 116,
  olistIdentities: 116,
  externalIdentities: 232,
  bothAccounts: 6,
} as const;

export interface ProductMaterializationApproval {
  sha256: string;
  products: number;
  listingItems: number;
  mercadoLivreIdentities: number;
  olistIdentities: number;
  externalIdentities: number;
  bothAccounts: number;
}

export interface ProductMaterializationExecution {
  mode: 'DRY_RUN' | 'EXECUTE';
  planSha256: string;
  candidateIds: string[];
  approvedTotals: {
    products: number;
    listingItems: number;
    mercadoLivreIdentities: number;
    olistIdentities: number;
    externalIdentities: number;
    bothAccounts: number;
  };
  productsToCreate: number;
  productsAlreadyMaterialized: number;
  listingLinksToCreate: number;
  listingLinksAlreadyCorrect: number;
  mercadoLivreIdentitiesToCreate: number;
  mercadoLivreIdentitiesAlreadyCorrect: number;
  olistIdentitiesToCreate: number;
  olistIdentitiesAlreadyCorrect: number;
  externalIdentitiesToCreate: number;
  externalIdentitiesAlreadyCorrect: number;
  conflicts: string[];
  writesPerformed: number;
}

export interface ProductMaterializationStore {
  loadState(plan: ProductMaterializationPlan): Promise<ProductMaterializationState>;
  runInTransaction<T>(
    operation: (store: ProductMaterializationStore) => Promise<T>,
  ): Promise<T>;
  apply(analysis: ProductMaterializationAnalysis): Promise<number>;
}

export interface ProductMaterializationState {
  products: ExistingProduct[];
  businessAccounts: ExistingBusinessAccount[];
  listingItems: ExistingListingItem[];
  externalIdentities: ExistingExternalIdentity[];
}

export interface ExistingProduct {
  id: string;
  sku: string;
  name: string;
}

export interface ExistingBusinessAccount {
  id: string;
  code: string;
}

export interface ExistingListingItem {
  id: string;
  productId: string | null;
  sellerSku: string | null;
  externalSellableId: string;
  marketplaceListing: {
    id: string;
    externalListingId: string;
    marketplaceAccountId: string;
    marketplaceAccount: {
      businessAccountId: string | null;
    };
  };
}

export interface ExistingExternalIdentity {
  id: string;
  productId: string;
  businessAccountId: string;
  provider: ProductIdentityProvider;
  sellerSku: string | null;
  externalListingId: string | null;
  externalVariationId: string | null;
  marketplaceListingItemId: string | null;
}

export interface ProductMaterializationPlan {
  diagnostic: string;
  summary: {
    listingItemsHigh: number;
    productCandidates: number;
    bothC1AndC2: number;
    ready: number;
    blocked: number;
    plannedWritesIfLaterAuthorized: {
      Product: number;
      MarketplaceListingItemProductLinks: number;
      ProductExternalIdentity: number;
      MercadoLivreIdentities: number;
      OlistIdentities: number;
    };
  };
  candidates: ProductMaterializationCandidate[];
}

export interface ProductMaterializationCandidate {
  productCandidateId: string;
  groupKey: string;
  evidenceHigh: string[];
  accounts: string[];
  listingItemCount: number;
  olistProductIds: Record<string, string[]>;
  gtin: string | null;
  observedSkus: string[];
  proposedProductSku: string;
  proposedProductName: string;
  listingItems: ProductMaterializationListingItem[];
  status: string;
  blockers: unknown[];
}

export interface ProductMaterializationListingItem {
  marketplaceListingItemId: string;
  account: string;
  businessAccountId: string;
  marketplaceAccountId: string;
  marketplaceListingId: string;
  externalListingId: string;
  externalSellableId: string;
  externalVariationId: string | null;
  sellerSku: string | null;
  olistProductId: string;
  olistSku: string | null;
  evidence: string;
}

export interface PlannedExternalIdentity {
  candidateSku: string;
  businessAccountId: string;
  provider: ProductIdentityProvider;
  sellerSku: string | null;
  externalListingId: string;
  externalVariationId: string | null;
  marketplaceListingItemId: string | null;
}

export interface ProductMaterializationAnalysis {
  plan: ProductMaterializationPlan;
  execution: ProductMaterializationExecution;
  existingProductIdsBySku: Map<string, string>;
  productSkusToCreate: Set<string>;
  listingItemIdsToLink: Set<string>;
  identitiesToCreate: PlannedExternalIdentity[];
}

export class ProductMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMaterializationError';
  }
}

export class ProductMaterializationService {
  constructor(
    private readonly store: ProductMaterializationStore,
    private readonly approval: ProductMaterializationApproval =
      APPROVED_PRODUCT_MATERIALIZATION,
  ) {}

  async execute(input: {
    planContents: Buffer;
    execute?: boolean;
    candidateIds?: string[];
  }): Promise<ProductMaterializationExecution> {
    const planSha256 = createHash('sha256')
      .update(input.planContents)
      .digest('hex');
    if (planSha256 !== this.approval.sha256) {
      throw new ProductMaterializationError(
        `Plan SHA-256 mismatch: expected ${this.approval.sha256}, received ${planSha256}.`,
      );
    }

    const approvedPlan = parseAndValidatePlan(input.planContents, this.approval);
    const plan = selectCandidates(approvedPlan, input.candidateIds ?? []);
    if (input.execute !== true) {
      const state = await this.store.loadState(plan);
      return analyzeMaterialization(plan, state, planSha256, true).execution;
    }

    const candidateExecutions: ProductMaterializationExecution[] = [];
    for (const candidate of plan.candidates) {
      const candidatePlan = planForCandidates(plan, [candidate]);
      const execution = await this.store.runInTransaction(
        async (transactionStore) => {
          const state = await transactionStore.loadState(candidatePlan);
          const analysis = analyzeMaterialization(
            candidatePlan,
            state,
            planSha256,
            false,
          );
          assertNoConflicts(analysis.execution);
          const writesPerformed = await transactionStore.apply(analysis);
          return { ...analysis.execution, writesPerformed };
        },
      );
      candidateExecutions.push(execution);
    }
    return combineExecutions(plan, planSha256, candidateExecutions);
  }
}

function selectCandidates(
  approvedPlan: ProductMaterializationPlan,
  requestedCandidateIds: string[],
): ProductMaterializationPlan {
  if (requestedCandidateIds.length === 0) return approvedPlan;

  const requested = new Set<string>();
  for (const candidateId of requestedCandidateIds) {
    if (!isNonEmptyString(candidateId)) {
      fail('Candidate id must be a non-empty string.');
    }
    addUnique(requested, candidateId, 'requested candidate id');
  }
  const candidatesById = new Map(
    approvedPlan.candidates.map((candidate) => [
      candidate.productCandidateId,
      candidate,
    ]),
  );
  const candidates = requestedCandidateIds.map((candidateId) => {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) {
      fail(`Candidate ${candidateId} does not exist in the approved plan.`);
    }
    assertHighCandidate(candidate);
    return candidate;
  });
  return planForCandidates(approvedPlan, candidates);
}

function planForCandidates(
  source: ProductMaterializationPlan,
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
    diagnostic: source.diagnostic,
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

function combineExecutions(
  plan: ProductMaterializationPlan,
  planSha256: string,
  executions: ProductMaterializationExecution[],
): ProductMaterializationExecution {
  const total = (
    key:
      | 'productsToCreate'
      | 'productsAlreadyMaterialized'
      | 'listingLinksToCreate'
      | 'listingLinksAlreadyCorrect'
      | 'mercadoLivreIdentitiesToCreate'
      | 'mercadoLivreIdentitiesAlreadyCorrect'
      | 'olistIdentitiesToCreate'
      | 'olistIdentitiesAlreadyCorrect'
      | 'externalIdentitiesToCreate'
      | 'externalIdentitiesAlreadyCorrect'
      | 'writesPerformed',
  ): number => executions.reduce((sum, execution) => sum + execution[key], 0);
  return {
    mode: 'EXECUTE',
    planSha256,
    candidateIds: plan.candidates.map(({ productCandidateId }) => productCandidateId),
    approvedTotals: {
      products: plan.summary.productCandidates,
      listingItems: plan.summary.listingItemsHigh,
      mercadoLivreIdentities:
        plan.summary.plannedWritesIfLaterAuthorized.MercadoLivreIdentities,
      olistIdentities:
        plan.summary.plannedWritesIfLaterAuthorized.OlistIdentities,
      externalIdentities:
        plan.summary.plannedWritesIfLaterAuthorized.ProductExternalIdentity,
      bothAccounts: plan.summary.bothC1AndC2,
    },
    productsToCreate: total('productsToCreate'),
    productsAlreadyMaterialized: total('productsAlreadyMaterialized'),
    listingLinksToCreate: total('listingLinksToCreate'),
    listingLinksAlreadyCorrect: total('listingLinksAlreadyCorrect'),
    mercadoLivreIdentitiesToCreate: total('mercadoLivreIdentitiesToCreate'),
    mercadoLivreIdentitiesAlreadyCorrect: total(
      'mercadoLivreIdentitiesAlreadyCorrect',
    ),
    olistIdentitiesToCreate: total('olistIdentitiesToCreate'),
    olistIdentitiesAlreadyCorrect: total('olistIdentitiesAlreadyCorrect'),
    externalIdentitiesToCreate: total('externalIdentitiesToCreate'),
    externalIdentitiesAlreadyCorrect: total('externalIdentitiesAlreadyCorrect'),
    conflicts: executions.flatMap(({ conflicts }) => conflicts),
    writesPerformed: total('writesPerformed'),
  };
}

function parseAndValidatePlan(
  contents: Buffer,
  approval: ProductMaterializationApproval,
): ProductMaterializationPlan {
  let value: unknown;
  try {
    value = JSON.parse(contents.toString('utf8'));
  } catch {
    throw new ProductMaterializationError('Plan is not valid JSON.');
  }
  if (!isRecord(value)) fail('Plan root must be an object.');
  const summary = record(value, 'summary');
  const writes = record(summary, 'plannedWritesIfLaterAuthorized');
  const candidates = array(value, 'candidates').map((candidate, index) =>
    parseCandidate(candidate, index),
  );

  const plan: ProductMaterializationPlan = {
    diagnostic: text(value, 'diagnostic'),
    summary: {
      listingItemsHigh: integer(summary, 'listingItemsHigh'),
      productCandidates: integer(summary, 'productCandidates'),
      bothC1AndC2: integer(summary, 'bothC1AndC2'),
      ready: integer(summary, 'ready'),
      blocked: integer(summary, 'blocked'),
      plannedWritesIfLaterAuthorized: {
        Product: integer(writes, 'Product'),
        MarketplaceListingItemProductLinks: integer(
          writes,
          'MarketplaceListingItemProductLinks',
        ),
        ProductExternalIdentity: integer(writes, 'ProductExternalIdentity'),
        MercadoLivreIdentities: integer(writes, 'MercadoLivreIdentities'),
        OlistIdentities: integer(writes, 'OlistIdentities'),
      },
    },
    candidates,
  };

  if (plan.diagnostic !== 'READ_ONLY_MATERIALIZATION_PLAN') {
    fail('Plan diagnostic is not READ_ONLY_MATERIALIZATION_PLAN.');
  }
  validateApprovedCounts(plan, approval);
  validateCandidateUniqueness(plan);
  return plan;
}

function parseCandidate(
  value: unknown,
  index: number,
): ProductMaterializationCandidate {
  if (!isRecord(value)) fail(`Candidate ${index + 1} must be an object.`);
  const listingItems = array(value, 'listingItems').map((item, itemIndex) =>
    parseListingItem(item, index, itemIndex),
  );
  const olistProductIdsValue = record(value, 'olistProductIds');
  const olistProductIds = Object.fromEntries(
    Object.entries(olistProductIdsValue).map(([account, ids]) => {
      if (!Array.isArray(ids) || !ids.every(isNonEmptyString)) {
        fail(`Candidate ${index + 1} has invalid Olist product ids.`);
      }
      return [account, ids as string[]];
    }),
  );
  const candidate: ProductMaterializationCandidate = {
    productCandidateId: text(value, 'productCandidateId'),
    groupKey: text(value, 'groupKey'),
    evidenceHigh: stringArray(value, 'evidenceHigh'),
    accounts: stringArray(value, 'accounts'),
    listingItemCount: integer(value, 'listingItemCount'),
    olistProductIds,
    gtin: nullableText(value, 'gtin'),
    observedSkus: stringArray(value, 'observedSkus'),
    proposedProductSku: text(value, 'proposedProductSku'),
    proposedProductName: text(value, 'proposedProductName'),
    listingItems,
    status: text(value, 'status'),
    blockers: array(value, 'blockers'),
  };
  validateCandidate(candidate);
  return candidate;
}

function parseListingItem(
  value: unknown,
  candidateIndex: number,
  itemIndex: number,
): ProductMaterializationListingItem {
  if (!isRecord(value)) {
    fail(
      `Listing item ${itemIndex + 1} of candidate ${candidateIndex + 1} must be an object.`,
    );
  }
  return {
    marketplaceListingItemId: uuid(value, 'marketplaceListingItemId'),
    account: text(value, 'account'),
    businessAccountId: uuid(value, 'businessAccountId'),
    marketplaceAccountId: uuid(value, 'marketplaceAccountId'),
    marketplaceListingId: uuid(value, 'marketplaceListingId'),
    externalListingId: text(value, 'externalListingId'),
    externalSellableId: text(value, 'externalSellableId'),
    externalVariationId: nullableText(value, 'externalVariationId'),
    sellerSku: nullableText(value, 'sellerSku'),
    olistProductId: text(value, 'olistProductId'),
    olistSku: nullableText(value, 'olistSku'),
    evidence: text(value, 'evidence'),
  };
}

function validateApprovedCounts(
  plan: ProductMaterializationPlan,
  approval: ProductMaterializationApproval,
): void {
  const writes = plan.summary.plannedWritesIfLaterAuthorized;
  const actualListingItems = plan.candidates.reduce(
    (total, candidate) => total + candidate.listingItems.length,
    0,
  );
  const actualBothAccounts = plan.candidates.filter(
    ({ accounts }) => accounts.includes('C1') && accounts.includes('C2'),
  ).length;
  const actual = {
    products: plan.candidates.length,
    listingItems: actualListingItems,
    mercadoLivreIdentities: actualListingItems,
    olistIdentities: actualListingItems,
    externalIdentities: actualListingItems * 2,
    bothAccounts: actualBothAccounts,
  };
  const declared = {
    products: plan.summary.productCandidates,
    listingItems: plan.summary.listingItemsHigh,
    mercadoLivreIdentities: writes.MercadoLivreIdentities,
    olistIdentities: writes.OlistIdentities,
    externalIdentities: writes.ProductExternalIdentity,
    bothAccounts: plan.summary.bothC1AndC2,
  };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (actual[key] !== approval[key] || declared[key] !== approval[key]) {
      fail(
        `Approved count mismatch for ${key}: expected ${approval[key]}, declared ${declared[key]}, found ${actual[key]}.`,
      );
    }
  }
  if (
    writes.Product !== approval.products ||
    writes.MarketplaceListingItemProductLinks !== approval.listingItems ||
    plan.summary.ready !== approval.products ||
    plan.summary.blocked !== 0
  ) {
    fail('Plan write totals or READY/BLOCKED totals differ from approval.');
  }
}

function validateCandidate(candidate: ProductMaterializationCandidate): void {
  assertHighCandidate(candidate);
  if (
    candidate.status !== 'READY' ||
    candidate.blockers.length !== 0 ||
    candidate.listingItemCount !== candidate.listingItems.length ||
    candidate.listingItems.length === 0
  ) {
    fail(`${candidate.productCandidateId} is not a non-empty READY candidate.`);
  }
  const accounts = new Set(candidate.accounts);
  if (
    accounts.size !== candidate.accounts.length ||
    candidate.listingItems.some((item) => !accounts.has(item.account))
  ) {
    fail(`${candidate.productCandidateId} has inconsistent accounts.`);
  }
  if (
    candidate.evidenceHigh.length === 0 ||
    candidate.evidenceHigh.some(
      (evidence) => evidence !== 'ORDER_PRODUCT_ID' && evidence !== 'GTIN_UNIQUE',
    ) ||
    candidate.listingItems.some(
      ({ evidence }) =>
        evidence !== 'ORDER_PRODUCT_ID' && evidence !== 'GTIN_UNIQUE',
    )
  ) {
    fail(`${candidate.productCandidateId} contains unapproved evidence.`);
  }

  if (candidate.gtin !== null) {
    const expectedSku = `PRD-GTIN-${candidate.gtin}`;
    if (
      !/^\d{8,14}$/.test(candidate.gtin) ||
      candidate.proposedProductSku !== expectedSku ||
      candidate.groupKey !== `GTIN:${candidate.gtin}`
    ) {
      fail(`${candidate.productCandidateId} has an invalid GTIN canonical key.`);
    }
  } else {
    const [first] = candidate.listingItems;
    const expectedSku = `PRD-OLIST-${first!.account}-${first!.olistProductId}`;
    if (
      candidate.listingItems.length !== 1 ||
      candidate.proposedProductSku !== expectedSku ||
      candidate.groupKey !== `${first!.account}:OLIST:${first!.olistProductId}`
    ) {
      fail(`${candidate.productCandidateId} has an invalid Olist canonical key.`);
    }
  }

  for (const item of candidate.listingItems) {
    if (
      (item.externalVariationId === null &&
        item.externalSellableId !== item.externalListingId) ||
      (item.externalVariationId !== null &&
        item.externalSellableId !== item.externalVariationId)
    ) {
      fail(`${candidate.productCandidateId} has an inconsistent ML sellable.`);
    }
    if (
      !candidate.olistProductIds[item.account]?.includes(item.olistProductId)
    ) {
      fail(`${candidate.productCandidateId} has an inconsistent Olist identity.`);
    }
  }
}

function assertHighCandidate(candidate: ProductMaterializationCandidate): void {
  if (!/^PC-HIGH-[A-Z0-9][A-Z0-9-]*$/.test(candidate.productCandidateId)) {
    fail(`${candidate.productCandidateId} is not classified HIGH.`);
  }
}

function validateCandidateUniqueness(plan: ProductMaterializationPlan): void {
  const candidateIds = new Set<string>();
  const groupKeys = new Set<string>();
  const productSkus = new Set<string>();
  const listingItems = new Set<string>();
  const identityKeys = new Map<string, string>();
  for (const candidate of plan.candidates) {
    addUnique(candidateIds, candidate.productCandidateId, 'candidate id');
    addUnique(groupKeys, candidate.groupKey, 'candidate group key');
    addUnique(productSkus, candidate.proposedProductSku, 'Product.sku');
    for (const item of candidate.listingItems) {
      addUnique(listingItems, item.marketplaceListingItemId, 'listing item');
      for (const identity of plannedIdentities(candidate, item)) {
        const key = externalIdentityKey(identity);
        const previousOwner = identityKeys.get(key);
        if (previousOwner && previousOwner !== candidate.proposedProductSku) {
          fail(`External identity ${key} is duplicated across candidates.`);
        }
        if (previousOwner) fail(`External identity ${key} is duplicated.`);
        identityKeys.set(key, candidate.proposedProductSku);
      }
    }
  }
}

function analyzeMaterialization(
  plan: ProductMaterializationPlan,
  state: ProductMaterializationState,
  planSha256: string,
  dryRun: boolean,
): ProductMaterializationAnalysis {
  const conflicts: string[] = [];
  const existingProductIdsBySku = new Map(
    state.products.map((product) => [product.sku, product.id]),
  );
  const productSkusToCreate = new Set<string>();
  const listingItemIdsToLink = new Set<string>();
  const identitiesToCreate: PlannedExternalIdentity[] = [];
  const businessAccounts = new Map(
    state.businessAccounts.map((account) => [account.id, account]),
  );
  const listingItems = new Map(state.listingItems.map((item) => [item.id, item]));
  const identitiesBySellable = new Map<string, ExistingExternalIdentity[]>();
  const identitiesByListingItem = new Map<string, ExistingExternalIdentity[]>();
  for (const identity of state.externalIdentities) {
    if (identity.externalListingId !== null) {
      pushMap(identitiesBySellable, externalIdentityKey(identity), identity);
    }
    if (identity.marketplaceListingItemId !== null) {
      pushMap(
        identitiesByListingItem,
        identity.marketplaceListingItemId,
        identity,
      );
    }
  }

  let listingLinksAlreadyCorrect = 0;
  let mercadoLivreIdentitiesAlreadyCorrect = 0;
  let olistIdentitiesAlreadyCorrect = 0;
  for (const candidate of plan.candidates) {
    const existingProductId = existingProductIdsBySku.get(
      candidate.proposedProductSku,
    );
    if (!existingProductId) productSkusToCreate.add(candidate.proposedProductSku);

    for (const plannedItem of candidate.listingItems) {
      const businessAccount = businessAccounts.get(plannedItem.businessAccountId);
      if (!businessAccount || businessAccount.code !== plannedItem.account) {
        conflicts.push(
          `${candidate.productCandidateId}: missing or mismatched BusinessAccount ${plannedItem.businessAccountId}.`,
        );
      }
      const currentItem = listingItems.get(plannedItem.marketplaceListingItemId);
      if (!currentItem) {
        conflicts.push(
          `${candidate.productCandidateId}: missing listing item ${plannedItem.marketplaceListingItemId}.`,
        );
      } else {
        validateListingItemSnapshot(candidate, plannedItem, currentItem, conflicts);
        if (currentItem.productId === null) {
          listingItemIdsToLink.add(plannedItem.marketplaceListingItemId);
        } else if (existingProductId && currentItem.productId === existingProductId) {
          listingLinksAlreadyCorrect += 1;
        } else {
          conflicts.push(
            `${candidate.productCandidateId}: listing item ${plannedItem.marketplaceListingItemId} belongs to another Product.`,
          );
        }
      }

      for (const identity of plannedIdentities(candidate, plannedItem)) {
        const matches = new Map<string, ExistingExternalIdentity>();
        for (const match of identitiesBySellable.get(externalIdentityKey(identity)) ?? []) {
          matches.set(match.id, match);
        }
        if (identity.marketplaceListingItemId !== null) {
          for (const match of
            identitiesByListingItem.get(identity.marketplaceListingItemId) ?? []) {
            matches.set(match.id, match);
          }
        }
        if (matches.size > 1) {
          conflicts.push(
            `${candidate.productCandidateId}: identity ${externalIdentityKey(identity)} resolves to multiple current rows.`,
          );
          continue;
        }
        const [currentIdentity] = matches.values();
        if (!currentIdentity) {
          identitiesToCreate.push(identity);
          continue;
        }
        if (
          !existingProductId ||
          currentIdentity.productId !== existingProductId ||
          !sameIdentity(currentIdentity, identity)
        ) {
          conflicts.push(
            `${candidate.productCandidateId}: identity ${externalIdentityKey(identity)} belongs to another Product or has different attributes.`,
          );
          continue;
        }
        if (identity.provider === ProductIdentityProvider.MERCADO_LIVRE) {
          mercadoLivreIdentitiesAlreadyCorrect += 1;
        } else {
          olistIdentitiesAlreadyCorrect += 1;
        }
      }
    }
  }

  const mercadoLivreIdentitiesToCreate = identitiesToCreate.filter(
    ({ provider }) => provider === ProductIdentityProvider.MERCADO_LIVRE,
  ).length;
  const olistIdentitiesToCreate = identitiesToCreate.filter(
    ({ provider }) => provider === ProductIdentityProvider.OLIST,
  ).length;
  const execution: ProductMaterializationExecution = {
    mode: dryRun ? 'DRY_RUN' : 'EXECUTE',
    planSha256,
    candidateIds: plan.candidates.map(({ productCandidateId }) => productCandidateId),
    approvedTotals: {
      products: plan.candidates.length,
      listingItems: plan.summary.listingItemsHigh,
      mercadoLivreIdentities:
        plan.summary.plannedWritesIfLaterAuthorized.MercadoLivreIdentities,
      olistIdentities:
        plan.summary.plannedWritesIfLaterAuthorized.OlistIdentities,
      externalIdentities:
        plan.summary.plannedWritesIfLaterAuthorized.ProductExternalIdentity,
      bothAccounts: plan.summary.bothC1AndC2,
    },
    productsToCreate: productSkusToCreate.size,
    productsAlreadyMaterialized:
      plan.candidates.length - productSkusToCreate.size,
    listingLinksToCreate: listingItemIdsToLink.size,
    listingLinksAlreadyCorrect,
    mercadoLivreIdentitiesToCreate,
    mercadoLivreIdentitiesAlreadyCorrect,
    olistIdentitiesToCreate,
    olistIdentitiesAlreadyCorrect,
    externalIdentitiesToCreate: identitiesToCreate.length,
    externalIdentitiesAlreadyCorrect:
      mercadoLivreIdentitiesAlreadyCorrect + olistIdentitiesAlreadyCorrect,
    conflicts: [...new Set(conflicts)],
    writesPerformed: 0,
  };
  assertNoConflicts(execution);
  return {
    plan,
    execution,
    existingProductIdsBySku,
    productSkusToCreate,
    listingItemIdsToLink,
    identitiesToCreate,
  };
}

function validateListingItemSnapshot(
  candidate: ProductMaterializationCandidate,
  planned: ProductMaterializationListingItem,
  current: ExistingListingItem,
  conflicts: string[],
): void {
  if (
    current.sellerSku !== planned.sellerSku ||
    current.externalSellableId !== planned.externalSellableId ||
    current.marketplaceListing.id !== planned.marketplaceListingId ||
    current.marketplaceListing.externalListingId !== planned.externalListingId ||
    current.marketplaceListing.marketplaceAccountId !==
      planned.marketplaceAccountId ||
    current.marketplaceListing.marketplaceAccount.businessAccountId !==
      planned.businessAccountId
  ) {
    conflicts.push(
      `${candidate.productCandidateId}: listing item ${planned.marketplaceListingItemId} no longer matches the approved snapshot.`,
    );
  }
}

function plannedIdentities(
  candidate: ProductMaterializationCandidate,
  item: ProductMaterializationListingItem,
): PlannedExternalIdentity[] {
  return [
    {
      candidateSku: candidate.proposedProductSku,
      businessAccountId: item.businessAccountId,
      provider: ProductIdentityProvider.MERCADO_LIVRE,
      sellerSku: item.sellerSku,
      externalListingId: item.externalListingId,
      externalVariationId: item.externalVariationId,
      marketplaceListingItemId: item.marketplaceListingItemId,
    },
    {
      candidateSku: candidate.proposedProductSku,
      businessAccountId: item.businessAccountId,
      provider: ProductIdentityProvider.OLIST,
      sellerSku: item.olistSku,
      externalListingId: item.olistProductId,
      externalVariationId: null,
      marketplaceListingItemId: null,
    },
  ];
}

export function externalIdentityKey(identity: {
  businessAccountId: string;
  provider: ProductIdentityProvider;
  externalListingId: string | null;
  externalVariationId: string | null;
}): string {
  return [
    identity.businessAccountId,
    identity.provider,
    identity.externalListingId ?? '',
    identity.externalVariationId ?? '',
  ].join('|');
}

function sameIdentity(
  current: ExistingExternalIdentity,
  planned: PlannedExternalIdentity,
): boolean {
  return (
    current.businessAccountId === planned.businessAccountId &&
    current.provider === planned.provider &&
    current.sellerSku === planned.sellerSku &&
    current.externalListingId === planned.externalListingId &&
    current.externalVariationId === planned.externalVariationId &&
    current.marketplaceListingItemId === planned.marketplaceListingItemId
  );
}

function assertNoConflicts(execution: ProductMaterializationExecution): void {
  if (execution.conflicts.length > 0) {
    throw new ProductMaterializationError(
      `Materialization blocked by ${execution.conflicts.length} conflict(s):\n${execution.conflicts.join('\n')}`,
    );
  }
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function addUnique(set: Set<string>, value: string, label: string): void {
  if (set.has(value)) fail(`Duplicate ${label}: ${value}.`);
  set.add(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function record(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const result = value[key];
  if (!isRecord(result)) fail(`${key} must be an object.`);
  return result;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
  const result = value[key];
  if (!Array.isArray(result)) fail(`${key} must be an array.`);
  return result;
}

function stringArray(value: Record<string, unknown>, key: string): string[] {
  const result = array(value, key);
  if (!result.every(isNonEmptyString)) fail(`${key} must contain strings.`);
  return result as string[];
}

function text(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (!isNonEmptyString(result)) fail(`${key} must be a non-empty string.`);
  return result;
}

function nullableText(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const result = value[key];
  if (result !== null && !isNonEmptyString(result)) {
    fail(`${key} must be null or a non-empty string.`);
  }
  return result as string | null;
}

function integer(value: Record<string, unknown>, key: string): number {
  const result = value[key];
  if (!Number.isInteger(result) || (result as number) < 0) {
    fail(`${key} must be a non-negative integer.`);
  }
  return result as number;
}

function uuid(value: Record<string, unknown>, key: string): string {
  const result = text(value, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    fail(`${key} must be a UUID.`);
  }
  return result;
}

function fail(message: string): never {
  throw new ProductMaterializationError(message);
}
