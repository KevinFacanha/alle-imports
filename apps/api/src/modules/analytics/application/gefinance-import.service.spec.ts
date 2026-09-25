import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GeFinanceImportError,
  GeFinanceImportService,
} from './gefinance-import.service.js';

const SHA256 = 'a'.repeat(64);
const DAILY_DAYS = [
  {
    businessDate: '2026-09-01',
    recordCount: 123,
    sha256: '1'.repeat(64),
  },
];
const PLAN = {
  daysFound: 1,
  skipped: 0,
  localRefreshDays: 0,
  externalProcessingDays: 1,
  currentDayIgnored: 0,
  days: [
    {
      date: DAILY_DAYS[0]!.businessDate,
      sha256: DAILY_DAYS[0]!.sha256,
      action: 'FULL_EXTERNAL_PROCESS' as const,
    },
  ],
};
const INSPECTION = {
  from: '2026-09-01',
  to: '2026-09-22',
  recordCount: 123,
  days: DAILY_DAYS,
  channels: [
    {
      original: 'ML_ALEIMMPORTS 2',
      normalized: 'MERCADO_LIVRE_ACCOUNT_2' as const,
      recordCount: 100,
    },
    {
      original: 'Mercado Livre Fulfillment C2',
      normalized: 'MERCADO_LIVRE_FULFILLMENT_C2' as const,
      recordCount: 23,
    },
  ],
};

describe('GeFinanceImportService', () => {
  it('resolves Conta 1 by C1 channels and integrationKey even without a space before the account ordinal', async () => {
    const c1Inspection = {
      ...INSPECTION,
      channels: [
        {
          original: 'ML_ALEIMMPORTS 1',
          normalized: 'MERCADO_LIVRE_ACCOUNT_1' as const,
          recordCount: 100,
        },
        {
          original: 'Mercado Livre Fulfillment C1',
          normalized: 'MERCADO_LIVRE_FULFILLMENT_C1' as const,
          recordCount: 23,
        },
      ],
    };
    const backfill = new BackfillFake();
    const service = new GeFinanceImportService(
      database(
        [
          { id: 'ml-1', name: 'ALE_IMPORTS1' },
          { id: 'ml-2', name: 'ALE_IMPORTS 2' },
        ],
        [
          { id: 'olist-1', name: 'Ale Imports', integrationKey: 'c1' },
          { id: 'olist-2', name: 'Ale Imports', integrationKey: 'c2' },
        ],
      ) as never,
      backfill as never,
      () => ({
        inspectReport: async () => c1Inspection,
        getFinancialEvidence: async () => ({ records: [] }),
      }) as never,
    );

    const result = await service.execute({
      file: '/reports/gefinance-c1.xlsx',
      sha256: SHA256,
    });

    assert.equal(result.marketplaceAccount.id, 'ml-1');
    assert.equal(result.olistAccount.id, 'olist-1');
    assert.equal(result.olistAccount.integrationKey, 'c1');
  });

  it('prefers formal BusinessAccount identity over names and integration keys', async () => {
    const service = createService(
      [
        {
          id: 'ml-formal-c2',
          name: 'Nome sem ordinal',
          businessAccountCode: 'C2',
        },
        { id: 'ml-legacy-c2', name: 'LEGACY 2' },
      ],
      [
        {
          id: 'olist-formal-c2',
          name: 'Nome sem identidade textual',
          integrationKey: 'credential-slot',
          businessAccountCode: 'C2',
        },
        { id: 'olist-legacy-c2', name: 'Legacy', integrationKey: 'c2' },
      ],
    );

    const result = await service.execute({
      file: '/reports/gefinance-c2.xlsx',
      sha256: SHA256,
    });

    assert.equal(result.marketplaceAccount.id, 'ml-formal-c2');
    assert.equal(result.olistAccount.id, 'olist-formal-c2');
    assert.equal(result.olistAccount.integrationKey, 'credential-slot');
  });

  it('detects the report scope, resolves exact related accounts and reuses the backfill service', async () => {
    const provider = {
      inspectReport: async () => INSPECTION,
      getFinancialEvidence: async () => ({ records: [] }),
    };
    const backfill = new BackfillFake();
    const service = new GeFinanceImportService(
      database([
        { id: 'ml-1', name: 'ALE_IMPORTS1' },
        { id: 'ml-2', name: 'ALE_IMPORTS 2' },
      ], [{ id: 'olist-1', name: 'Ale Imports ', integrationKey: 'c2' }]) as never,
      backfill as never,
      () => provider as never,
    );

    const result = await service.execute({
      file: '/reports/gefinance.xlsx',
      sha256: SHA256,
    });

    assert.equal(result.marketplaceAccount.id, 'ml-2');
    assert.equal(result.olistAccount.id, 'olist-1');
    assert.equal(result.report.recordCount, 123);
    assert.deepEqual(backfill.params, {
      marketplaceAccountId: 'ml-2',
      olistAccountId: 'olist-1',
      geFinanceReportPath: '/reports/gefinance.xlsx',
      geFinanceReportSha256: SHA256,
      geFinanceDays: DAILY_DAYS,
      geFinanceProvider: provider,
      from: '2026-09-01',
      to: '2026-09-22',
      plan: PLAN,
    });
  });

  it('backfills daily hashes locally after resolving the isolated C2 account', async () => {
    let financialEvidenceCalls = 0;
    const backfill = new BackfillFake();
    const service = new GeFinanceImportService(
      database(
        [{ id: 'ml-2', name: 'ALE_IMPORTS 2' }],
        [{ id: 'olist-2', name: 'Ale Imports', integrationKey: 'c2' }],
      ) as never,
      backfill as never,
      () => ({
        inspectReport: async () => INSPECTION,
        getFinancialEvidence: async () => {
          financialEvidenceCalls += 1;
          return { records: [] };
        },
      }) as never,
    );

    const result = await service.backfillDailyHashes({
      file: '/reports/gefinance.xlsx',
    });

    assert.equal(financialEvidenceCalls, 0);
    assert.equal(result.backfill.hashesFilled, 1);
    assert.deepEqual(backfill.localParams, {
      marketplaceAccountId: 'ml-2',
      from: INSPECTION.from,
      to: INSPECTION.to,
      days: DAILY_DAYS,
    });
  });

  it('fails instead of guessing when the marketplace account is ambiguous', async () => {
    const service = createService(
      [
        { id: 'ml-2a', name: 'ALE_IMPORTS 2' },
        { id: 'ml-2b', name: 'OUTRA LOJA 2' },
      ],
      [{ id: 'olist-1', name: 'Ale Imports', integrationKey: 'c2' }],
    );

    await assert.rejects(
      service.execute({ file: '/report.xlsx', sha256: SHA256 }),
      (error: unknown) =>
        error instanceof GeFinanceImportError &&
        /MarketplaceAccount.*encontradas 2/.test(error.message),
    );
  });

  it('fails instead of guessing when the related Olist account is ambiguous', async () => {
    const service = createService(
      [{ id: 'ml-2', name: 'ALE_IMPORTS 2' }],
      [
        { id: 'olist-1', name: 'Ale Imports', integrationKey: 'c2' },
        { id: 'olist-2', name: 'ALE_IMPORTS', integrationKey: 'c2' },
      ],
    );

    await assert.rejects(
      service.execute({ file: '/report.xlsx', sha256: SHA256 }),
      (error: unknown) =>
        error instanceof GeFinanceImportError &&
        /OlistAccount.*encontradas 2/.test(error.message),
    );
  });

  it('rejects unknown channels before querying accounts or running backfill', async () => {
    let queried = false;
    const db = database([], []);
    db.marketplaceAccount.findMany = async () => {
      queried = true;
      return [];
    };
    const backfill = new BackfillFake();
    const service = new GeFinanceImportService(
      db as never,
      backfill as never,
      () => ({
        inspectReport: async () => ({
          ...INSPECTION,
          channels: [
            { original: 'Canal desconhecido', normalized: 'OTHER', recordCount: 1 },
          ],
        }),
        getFinancialEvidence: async () => ({ records: [] }),
      }) as never,
    );

    await assert.rejects(
      service.execute({ file: '/report.xlsx', sha256: SHA256 }),
      /canal\(is\) sem vínculo seguro/,
    );
    assert.equal(queried, false);
    assert.equal(backfill.params, undefined);
  });

  it('rejects a C2 report in the C1 operational slot before querying accounts or running backfill', async () => {
    let queried = false;
    const db = database([], []);
    db.marketplaceAccount.findMany = async () => {
      queried = true;
      return [];
    };
    const backfill = new BackfillFake();
    const service = new GeFinanceImportService(
      db as never,
      backfill as never,
      () => ({
        inspectReport: async () => INSPECTION,
        getFinancialEvidence: async () => ({ records: [] }),
      }) as never,
    );

    await assert.rejects(
      service.execute({
        file: '/reports/gefinance-c1-latest.xlsx',
        sha256: SHA256,
        expectedAccountOrdinal: 1,
      }),
      (error: unknown) =>
        error instanceof GeFinanceImportError &&
        /esperado para C1 pertence à conta C2/.test(error.message),
    );
    assert.equal(queried, false);
    assert.equal(backfill.params, undefined);
  });
});

function createService(
  marketplaceAccounts: MarketplaceAccountFixture[],
  olistAccounts: OlistAccountFixture[],
): GeFinanceImportService {
  return new GeFinanceImportService(
    database(marketplaceAccounts, olistAccounts) as never,
    new BackfillFake() as never,
    () => ({
      inspectReport: async () => INSPECTION,
      getFinancialEvidence: async () => ({ records: [] }),
    }) as never,
  );
}

interface MarketplaceAccountFixture {
  id: string;
  name: string;
  businessAccountCode?: string | null;
}

interface OlistAccountFixture {
  id: string;
  name: string;
  integrationKey: string;
  businessAccountCode?: string | null;
}

function database(
  marketplaceAccounts: MarketplaceAccountFixture[],
  olistAccounts: OlistAccountFixture[],
) {
  return {
    marketplaceAccount: {
      findMany: async () =>
        marketplaceAccounts.map(({ businessAccountCode, ...account }) => ({
          ...account,
          businessAccount:
            businessAccountCode == null
              ? null
              : { code: businessAccountCode },
        })),
    },
    olistAccount: {
      findMany: async () =>
        olistAccounts.map(
          ({ integrationKey, businessAccountCode, ...account }) => ({
            ...account,
            businessAccount:
              businessAccountCode == null
                ? null
                : { code: businessAccountCode },
            authorization: { integrationKey },
          }),
        ),
    },
  };
}

class BackfillFake {
  params?: unknown;
  localParams?: unknown;
  preflightParams?: unknown;

  async preflight(params: unknown) {
    this.preflightParams = params;
    return PLAN;
  }

  async backfillGeFinanceDailyHashes(params: unknown) {
    this.localParams = params;
    return {
      daysFound: 1,
      snapshotsFound: 1,
      hashesFilled: 1,
      alreadyHashed: 0,
      snapshotsMissing: 0,
    };
  }

  async execute(params: unknown) {
    this.params = params;
    return {
      from: INSPECTION.from,
      to: INSPECTION.to,
      daysFound: 1,
      localRefreshDays: 0,
      externalProcessingDays: 1,
      currentDayIgnored: 0,
      skipped: 0,
      daysProcessed: 22,
      created: 22,
      updated: 0,
      failed: 0,
      elapsedMs: 1,
      days: [],
      snapshots: [],
    };
  }
}
