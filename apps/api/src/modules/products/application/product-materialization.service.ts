import { createHash } from 'node:crypto';

import { ProductIdentityProvider } from '@prisma/client';

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
  productsToReuse: number;
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
    productsToCreate: number;
    productsToReuse: number;
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
  classification: 'HIGH' | 'PROMOTABLE_TO_HIGH';
  action: 'CREATE_PRODUCT_AND_LINK' | 'REUSE_HIGH_PRODUCT_AND_LINK';
  groupKey: string;
  evidenceHigh: string[];
  accounts: string[];
  listingItemCount: number;
  olistProductIds: Record<string, string[]>;
  gtin: string | null;
  observedSkus: string[];
  proposedProductSku: string;
  proposedProductName: string;
  proposedProductId: string | null;
  listingItems: ProductMaterializationListingItem[];
  plannedIdentities: PlannedExternalIdentity[];
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
  action: 'CREATE' | 'ALREADY_CORRECT';
  existingIdentityId: string | null;
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
  constructor(private readonly store: ProductMaterializationStore) {}

  async execute(input: {
    planContents: Buffer;
    expectedSha256: string;
    execute?: boolean;
    candidateIds?: string[];
  }): Promise<ProductMaterializationExecution> {
    const planSha256 = createHash('sha256')
      .update(input.planContents)
      .digest('hex');
    if (planSha256 !== input.expectedSha256) {
      throw new ProductMaterializationError(
        `Plan SHA-256 mismatch: expected ${input.expectedSha256}, received ${planSha256}.`,
      );
    }

    const approvedPlan = parseAndValidatePlan(input.planContents);
    const plan = selectCandidates(approvedPlan, input.candidateIds ?? []);
    if (input.execute !== true) {
      const state = await this.store.loadState(plan);
      return analyzeMaterialization(plan, state, planSha256, true).execution;
    }

    const preflightState = await this.store.loadState(plan);
    analyzeMaterialization(plan, preflightState, planSha256, false);

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
  const identities = candidates.flatMap(({ plannedIdentities }) =>
    plannedIdentities,
  );
  const productsToCreate = candidates.filter(
    ({ action }) => action === 'CREATE_PRODUCT_AND_LINK',
  ).length;
  const productsToReuse = candidates.length - productsToCreate;
  const bothAccounts = candidates.filter(
    ({ accounts }) => accounts.includes('C1') && accounts.includes('C2'),
  ).length;
  return {
    diagnostic: source.diagnostic,
    summary: {
      listingItemsHigh: listingItems,
      productCandidates: candidates.length,
      bothC1AndC2: bothAccounts,
      productsToCreate,
      productsToReuse,
      ready: candidates.length,
      blocked: 0,
      plannedWritesIfLaterAuthorized: {
        Product: productsToCreate,
        MarketplaceListingItemProductLinks: listingItems,
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

function combineExecutions(
  plan: ProductMaterializationPlan,
  planSha256: string,
  executions: ProductMaterializationExecution[],
): ProductMaterializationExecution {
  const total = (
    key:
      | 'productsToCreate'
      | 'productsToReuse'
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
    productsToReuse: total('productsToReuse'),
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

function parseAndValidatePlan(contents: Buffer): ProductMaterializationPlan {
  let value: unknown;
  try {
    value = JSON.parse(contents.toString('utf8'));
  } catch {
    throw new ProductMaterializationError('Plan is not valid JSON.');
  }
  if (!isRecord(value)) fail('Plan root must be an object.');
  const diagnostic = text(value, 'diagnostic');
  const incremental = diagnostic === 'READ_ONLY_INCREMENTAL_MATERIALIZATION_PLAN';
  if (!incremental && diagnostic !== 'READ_ONLY_MATERIALIZATION_PLAN') {
    fail('Plan diagnostic is not an approved materialization plan type.');
  }
  if (incremental) validateIncrementalSource(value);

  const summary = record(value, 'summary');
  const writes = record(summary, 'plannedWritesIfLaterAuthorized');
  const candidates = array(value, 'candidates').map((candidate, index) =>
    parseCandidate(candidate, index, incremental),
  );
  const bothC1AndC2 = candidates.filter(
    ({ accounts }) => accounts.includes('C1') && accounts.includes('C2'),
  ).length;
  const productsToCreate = incremental
    ? integer(summary, 'productsToCreate')
    : candidates.length;
  const productsToReuse = incremental
    ? integer(summary, 'productsToReuse')
    : 0;

  const plan: ProductMaterializationPlan = {
    diagnostic,
    summary: {
      listingItemsHigh: integer(summary, 'listingItemsHigh'),
      productCandidates: integer(summary, 'productCandidates'),
      bothC1AndC2: incremental
        ? bothC1AndC2
        : integer(summary, 'bothC1AndC2'),
      productsToCreate,
      productsToReuse,
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

  validateDeclaredCounts(plan);
  validateCandidateUniqueness(plan);
  return plan;
}

function validateIncrementalSource(value: Record<string, unknown>): void {
  if (integer(value, 'version') !== 1) fail('Incremental plan version must be 1.');
  const sourceAudit = record(value, 'sourceAudit');
  if (text(sourceAudit, 'classification') !== 'PROMOTABLE_TO_HIGH') {
    fail('Incremental plan source classification is not PROMOTABLE_TO_HIGH.');
  }
  text(sourceAudit, 'repositoryCommit');
  text(sourceAudit, 'checkpoint');
  const window = record(sourceAudit, 'window');
  text(window, 'from');
  text(window, 'to');
  if (integer(window, 'days') === 0) fail('Incremental audit window is empty.');
  const rule = record(sourceAudit, 'rule');
  if (
    boolean(rule, 'accountScopedUnlinkedSellerSkuUnique') !== true ||
    boolean(rule, 'exactUniqueOlistCatalogMatch') !== true ||
    integer(rule, 'minimumIndependentPaidOrders') < 2 ||
    boolean(rule, 'sellerSkuConsistentInAllPaidOrders') !== true ||
    integer(rule, 'divergentEvidenceAllowed') !== 0
  ) {
    fail('Incremental plan source rule is not approved.');
  }
}

function parseCandidate(
  value: unknown,
  index: number,
  incremental: boolean,
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
  const proposedProductSku = text(value, 'proposedProductSku');
  const candidate: ProductMaterializationCandidate = {
    productCandidateId: text(value, 'productCandidateId'),
    classification: incremental ? 'PROMOTABLE_TO_HIGH' : 'HIGH',
    action: incremental
      ? materializationAction(value, 'action')
      : 'CREATE_PRODUCT_AND_LINK',
    groupKey: text(value, 'groupKey'),
    evidenceHigh: stringArray(value, 'evidenceHigh'),
    accounts: stringArray(value, 'accounts'),
    listingItemCount: integer(value, 'listingItemCount'),
    olistProductIds,
    gtin: nullableText(value, 'gtin'),
    observedSkus: stringArray(value, 'observedSkus'),
    proposedProductSku,
    proposedProductName: text(value, 'proposedProductName'),
    proposedProductId: incremental
      ? nullableUuid(value, 'proposedProductId')
      : null,
    listingItems,
    plannedIdentities: [],
    status: text(value, 'status'),
    blockers: array(value, 'blockers'),
  };
  candidate.plannedIdentities = incremental
    ? array(value, 'plannedIdentities').map((identity, identityIndex) =>
        parsePlannedIdentity(
          identity,
          proposedProductSku,
          index,
          identityIndex,
        ),
      )
    : listingItems.flatMap((item) =>
        derivePlannedIdentities(proposedProductSku, item),
      );
  if (incremental) validateIncrementalEvidence(value, candidate);
  validateCandidate(candidate);
  return candidate;
}

function parsePlannedIdentity(
  value: unknown,
  candidateSku: string,
  candidateIndex: number,
  identityIndex: number,
): PlannedExternalIdentity {
  if (!isRecord(value)) {
    fail(
      `Planned identity ${identityIndex + 1} of candidate ${candidateIndex + 1} must be an object.`,
    );
  }
  const providerValue = text(value, 'provider');
  if (
    providerValue !== ProductIdentityProvider.MERCADO_LIVRE &&
    providerValue !== ProductIdentityProvider.OLIST
  ) {
    fail(`Candidate ${candidateIndex + 1} has an invalid identity provider.`);
  }
  const actionValue = text(value, 'action');
  if (actionValue !== 'CREATE' && actionValue !== 'ALREADY_CORRECT') {
    fail(`Candidate ${candidateIndex + 1} has an invalid identity action.`);
  }
  return {
    candidateSku,
    businessAccountId: uuid(value, 'businessAccountId'),
    provider: providerValue,
    sellerSku: nullableText(value, 'sellerSku'),
    externalListingId: text(value, 'externalListingId'),
    externalVariationId: nullableText(value, 'externalVariationId'),
    marketplaceListingItemId: nullableUuid(value, 'marketplaceListingItemId'),
    action: actionValue,
    existingIdentityId: optionalNullableUuid(value, 'existingIdentityId'),
  };
}

function validateIncrementalEvidence(
  value: Record<string, unknown>,
  candidate: ProductMaterializationCandidate,
): void {
  if (
    text(value, 'classification') !== 'PROMOTABLE_TO_HIGH' ||
    text(value, 'identityBasis') !==
      'EXACT_ACCOUNT_SCOPED_OLIST_MATCH_CORROBORATED_BY_MULTIPLE_PAID_ORDERS'
  ) {
    fail(`${candidate.productCandidateId} has an unapproved classification basis.`);
  }
  const requiredEvidence = new Set([
    'OLIST_SKU_EXACT_UNIQUE',
    'PAID_ORDER_SELLER_SKU_CORROBORATION',
  ]);
  if (
    candidate.evidenceHigh.length !== requiredEvidence.size ||
    candidate.evidenceHigh.some((evidence) => !requiredEvidence.has(evidence)) ||
    candidate.listingItems.some(
      ({ evidence }) =>
        evidence !== 'OLIST_SKU_EXACT_UNIQUE_PLUS_MULTIPLE_PAID_ORDERS',
    )
  ) {
    fail(`${candidate.productCandidateId} contains unapproved evidence.`);
  }
  const audit = record(value, 'auditEvidence');
  if (
    integer(audit, 'exactOlistMatchesInAccount') !== 1 ||
    integer(audit, 'unlinkedListingItemsWithSkuInAccount') !== 1 ||
    integer(audit, 'paidOrderCount') < 2 ||
    integer(audit, 'paidUnits') < 1 ||
    stringArray(audit, 'paidOrderIds').length < 2 ||
    boolean(audit, 'sellerSkuConsistentInAllPaidOrders') !== true ||
    integer(audit, 'divergentEvidenceCount') !== 0
  ) {
    fail(`${candidate.productCandidateId} has insufficient audit evidence.`);
  }
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

function validateDeclaredCounts(plan: ProductMaterializationPlan): void {
  const writes = plan.summary.plannedWritesIfLaterAuthorized;
  const identities = plan.candidates.flatMap(({ plannedIdentities }) =>
    plannedIdentities,
  );
  const actual = {
    productCandidates: plan.candidates.length,
    productsToCreate: plan.candidates.filter(
      ({ action }) => action === 'CREATE_PRODUCT_AND_LINK',
    ).length,
    productsToReuse: plan.candidates.filter(
      ({ action }) => action === 'REUSE_HIGH_PRODUCT_AND_LINK',
    ).length,
    listingItems: plan.candidates.reduce(
      (total, candidate) => total + candidate.listingItems.length,
      0,
    ),
    mercadoLivreIdentities: identities.filter(
      ({ action, provider }) =>
        action === 'CREATE' &&
        provider === ProductIdentityProvider.MERCADO_LIVRE,
    ).length,
    olistIdentities: identities.filter(
      ({ action, provider }) =>
        action === 'CREATE' && provider === ProductIdentityProvider.OLIST,
    ).length,
    externalIdentities: identities.filter(({ action }) => action === 'CREATE')
      .length,
    bothAccounts: plan.candidates.filter(
      ({ accounts }) => accounts.includes('C1') && accounts.includes('C2'),
    ).length,
  };
  const declared = {
    productCandidates: plan.summary.productCandidates,
    productsToCreate: plan.summary.productsToCreate,
    productsToReuse: plan.summary.productsToReuse,
    listingItems: plan.summary.listingItemsHigh,
    mercadoLivreIdentities: writes.MercadoLivreIdentities,
    olistIdentities: writes.OlistIdentities,
    externalIdentities: writes.ProductExternalIdentity,
    bothAccounts: plan.summary.bothC1AndC2,
  };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (actual[key] !== declared[key]) {
      fail(
        `Declared count mismatch for ${key}: declared ${declared[key]}, found ${actual[key]}.`,
      );
    }
  }
  if (
    writes.Product !== actual.productsToCreate ||
    writes.MarketplaceListingItemProductLinks !== actual.listingItems ||
    plan.summary.ready !== actual.productCandidates ||
    plan.summary.blocked !== 0
  ) {
    fail('Plan write totals or READY/BLOCKED totals are inconsistent.');
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

  if (candidate.classification === 'HIGH') {
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
    validateHistoricalCanonicalKey(candidate);
  } else {
    validateIncrementalCanonicalKey(candidate);
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
    if (!candidate.olistProductIds[item.account]?.includes(item.olistProductId)) {
      fail(`${candidate.productCandidateId} has an inconsistent Olist identity.`);
    }
  }
  validatePlannedIdentities(candidate);
}

function validateHistoricalCanonicalKey(
  candidate: ProductMaterializationCandidate,
): void {
  if (candidate.gtin !== null) {
    const expectedSku = `PRD-GTIN-${candidate.gtin}`;
    if (
      !/^\d{8,14}$/.test(candidate.gtin) ||
      candidate.proposedProductSku !== expectedSku ||
      candidate.groupKey !== `GTIN:${candidate.gtin}`
    ) {
      fail(`${candidate.productCandidateId} has an invalid GTIN canonical key.`);
    }
    return;
  }
  validateOlistCanonicalKey(candidate);
}

function validateIncrementalCanonicalKey(
  candidate: ProductMaterializationCandidate,
): void {
  validateOlistCanonicalKey(candidate);
  if (
    (candidate.action === 'CREATE_PRODUCT_AND_LINK' &&
      candidate.proposedProductId !== null) ||
    (candidate.action === 'REUSE_HIGH_PRODUCT_AND_LINK' &&
      candidate.proposedProductId === null)
  ) {
    fail(`${candidate.productCandidateId} has an inconsistent Product action.`);
  }
}

function validateOlistCanonicalKey(
  candidate: ProductMaterializationCandidate,
): void {
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

function validatePlannedIdentities(
  candidate: ProductMaterializationCandidate,
): void {
  const expected = candidate.listingItems.flatMap((item) =>
    derivePlannedIdentities(candidate.proposedProductSku, item),
  );
  if (candidate.plannedIdentities.length !== expected.length) {
    fail(`${candidate.productCandidateId} has incomplete planned identities.`);
  }
  for (const identity of candidate.plannedIdentities) {
    const matchingExpected = expected.find(
      (expectedIdentity) => samePlannedIdentity(expectedIdentity, identity),
    );
    if (!matchingExpected) {
      fail(`${candidate.productCandidateId} has an inconsistent planned identity.`);
    }
    if (
      (identity.action === 'CREATE' && identity.existingIdentityId !== null) ||
      (identity.action === 'ALREADY_CORRECT' &&
        (identity.existingIdentityId === null ||
          identity.provider !== ProductIdentityProvider.OLIST))
    ) {
      fail(`${candidate.productCandidateId} has an inconsistent identity action.`);
    }
  }
  const alreadyCorrect = candidate.plannedIdentities.filter(
    ({ action }) => action === 'ALREADY_CORRECT',
  );
  if (
    (candidate.action === 'CREATE_PRODUCT_AND_LINK' &&
      alreadyCorrect.length !== 0) ||
    (candidate.action === 'REUSE_HIGH_PRODUCT_AND_LINK' &&
      alreadyCorrect.length === 0)
  ) {
    fail(`${candidate.productCandidateId} has inconsistent reuse identities.`);
  }
}

function samePlannedIdentity(
  left: PlannedExternalIdentity,
  right: PlannedExternalIdentity,
): boolean {
  return (
    left.candidateSku === right.candidateSku &&
    left.businessAccountId === right.businessAccountId &&
    left.provider === right.provider &&
    left.sellerSku === right.sellerSku &&
    left.externalListingId === right.externalListingId &&
    left.externalVariationId === right.externalVariationId &&
    left.marketplaceListingItemId === right.marketplaceListingItemId
  );
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
    }
    for (const identity of candidate.plannedIdentities) {
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

function analyzeMaterialization(
  plan: ProductMaterializationPlan,
  state: ProductMaterializationState,
  planSha256: string,
  dryRun: boolean,
): ProductMaterializationAnalysis {
  const conflicts: string[] = [];
  const existingProductIdsBySku = new Map<string, string>();
  const productsBySku = new Map(
    state.products.map((product) => [product.sku, product]),
  );
  const productsById = new Map(
    state.products.map((product) => [product.id, product]),
  );
  const productSkusToCreate = new Set<string>();
  const listingItemIdsToLink = new Set<string>();
  const identitiesToCreate: PlannedExternalIdentity[] = [];
  const targetProductIds = new Map<string, string | undefined>();
  const businessAccounts = new Map(
    state.businessAccounts.map((account) => [account.id, account]),
  );
  const listingItems = new Map(state.listingItems.map((item) => [item.id, item]));
  const identitiesById = new Map(
    state.externalIdentities.map((identity) => [identity.id, identity]),
  );
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

  for (const candidate of plan.candidates) {
    const productBySku = productsBySku.get(candidate.proposedProductSku);
    if (candidate.action === 'REUSE_HIGH_PRODUCT_AND_LINK') {
      const productById = productsById.get(candidate.proposedProductId!);
      if (
        !productById ||
        productById.sku !== candidate.proposedProductSku ||
        (productBySku !== undefined && productBySku.id !== productById.id)
      ) {
        conflicts.push(
          `${candidate.productCandidateId}: destination Product ${candidate.proposedProductId} does not exactly match ${candidate.proposedProductSku}.`,
        );
        targetProductIds.set(candidate.proposedProductSku, undefined);
      } else {
        existingProductIdsBySku.set(productById.sku, productById.id);
        targetProductIds.set(candidate.proposedProductSku, productById.id);
      }
      continue;
    }
    if (!productBySku) {
      productSkusToCreate.add(candidate.proposedProductSku);
      targetProductIds.set(candidate.proposedProductSku, undefined);
    } else if (productBySku.name !== candidate.proposedProductName) {
      conflicts.push(
        `${candidate.productCandidateId}: existing Product ${productBySku.id} has a different canonical name.`,
      );
      targetProductIds.set(candidate.proposedProductSku, undefined);
    } else {
      existingProductIdsBySku.set(productBySku.sku, productBySku.id);
      targetProductIds.set(candidate.proposedProductSku, productBySku.id);
    }
  }

  let listingLinksAlreadyCorrect = 0;
  let mercadoLivreIdentitiesAlreadyCorrect = 0;
  let olistIdentitiesAlreadyCorrect = 0;
  for (const candidate of plan.candidates) {
    const targetProductId = targetProductIds.get(candidate.proposedProductSku);
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
        } else if (
          targetProductId !== undefined &&
          currentItem.productId === targetProductId
        ) {
          listingLinksAlreadyCorrect += 1;
        } else {
          conflicts.push(
            `${candidate.productCandidateId}: listing item ${plannedItem.marketplaceListingItemId} belongs to another Product.`,
          );
        }
      }
    }

    for (const identity of candidate.plannedIdentities) {
      const matches = new Map<string, ExistingExternalIdentity>();
      for (const match of
        identitiesBySellable.get(externalIdentityKey(identity)) ?? []) {
        matches.set(match.id, match);
      }
      if (identity.marketplaceListingItemId !== null) {
        for (const match of
          identitiesByListingItem.get(identity.marketplaceListingItemId) ?? []) {
          matches.set(match.id, match);
        }
      }
      if (identity.existingIdentityId !== null) {
        const match = identitiesById.get(identity.existingIdentityId);
        if (match) matches.set(match.id, match);
      }
      if (matches.size > 1) {
        conflicts.push(
          `${candidate.productCandidateId}: identity ${externalIdentityKey(identity)} resolves to multiple current rows.`,
        );
        continue;
      }
      const [currentIdentity] = matches.values();
      if (!currentIdentity) {
        if (identity.action === 'ALREADY_CORRECT') {
          conflicts.push(
            `${candidate.productCandidateId}: approved existing identity ${identity.existingIdentityId} is missing.`,
          );
        } else {
          identitiesToCreate.push(identity);
        }
        continue;
      }
      if (
        targetProductId === undefined ||
        currentIdentity.productId !== targetProductId ||
        !sameIdentity(currentIdentity, identity) ||
        (identity.existingIdentityId !== null &&
          currentIdentity.id !== identity.existingIdentityId)
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
    productsToCreate: productSkusToCreate.size,
    productsToReuse: plan.summary.productsToReuse,
    productsAlreadyMaterialized: existingProductIdsBySku.size,
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

function derivePlannedIdentities(
  candidateSku: string,
  item: ProductMaterializationListingItem,
): PlannedExternalIdentity[] {
  return [
    {
      candidateSku,
      businessAccountId: item.businessAccountId,
      provider: ProductIdentityProvider.MERCADO_LIVRE,
      sellerSku: item.sellerSku,
      externalListingId: item.externalListingId,
      externalVariationId: item.externalVariationId,
      marketplaceListingItemId: item.marketplaceListingItemId,
      action: 'CREATE',
      existingIdentityId: null,
    },
    {
      candidateSku,
      businessAccountId: item.businessAccountId,
      provider: ProductIdentityProvider.OLIST,
      sellerSku: item.olistSku,
      externalListingId: item.olistProductId,
      externalVariationId: null,
      marketplaceListingItemId: null,
      action: 'CREATE',
      existingIdentityId: null,
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

function boolean(value: Record<string, unknown>, key: string): boolean {
  const result = value[key];
  if (typeof result !== 'boolean') fail(`${key} must be a boolean.`);
  return result;
}

function materializationAction(
  value: Record<string, unknown>,
  key: string,
): ProductMaterializationCandidate['action'] {
  const result = text(value, key);
  if (
    result !== 'CREATE_PRODUCT_AND_LINK' &&
    result !== 'REUSE_HIGH_PRODUCT_AND_LINK'
  ) {
    fail(`${key} must be a supported materialization action.`);
  }
  return result;
}

function uuid(value: Record<string, unknown>, key: string): string {
  const result = text(value, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    fail(`${key} must be a UUID.`);
  }
  return result;
}

function nullableUuid(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const result = value[key];
  if (result === null) return null;
  return uuid(value, key);
}

function optionalNullableUuid(
  value: Record<string, unknown>,
  key: string,
): string | null {
  if (value[key] === undefined) return null;
  return nullableUuid(value, key);
}

function fail(message: string): never {
  throw new ProductMaterializationError(message);
}
