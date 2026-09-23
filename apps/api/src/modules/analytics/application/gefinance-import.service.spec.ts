import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GeFinanceImportError,
  GeFinanceImportService,
} from './gefinance-import.service.js';

const SHA256 = 'a'.repeat(64);
const INSPECTION = {
  from: '2026-09-01',
  to: '2026-09-22',
  recordCount: 123,
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
      geFinanceProvider: provider,
      from: '2026-09-01',
      to: '2026-09-22',
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
});

function createService(
  marketplaceAccounts: Array<{ id: string; name: string }>,
  olistAccounts: Array<{ id: string; name: string; integrationKey: string }>,
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

function database(
  marketplaceAccounts: Array<{ id: string; name: string }>,
  olistAccounts: Array<{ id: string; name: string; integrationKey: string }>,
) {
  return {
    marketplaceAccount: { findMany: async () => marketplaceAccounts },
    olistAccount: {
      findMany: async () => olistAccounts.map(({ integrationKey, ...account }) => ({
        ...account,
        authorization: { integrationKey },
      })),
    },
  };
}

class BackfillFake {
  params?: unknown;

  async execute(params: unknown) {
    this.params = params;
    return {
      from: INSPECTION.from,
      to: INSPECTION.to,
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
