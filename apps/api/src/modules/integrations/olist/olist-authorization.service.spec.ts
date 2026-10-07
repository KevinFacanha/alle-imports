import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import { TokenEncryptionService } from '../oauth/token-encryption.service.js';
import {
  OlistIntegrationConfigService,
  OlistIntegrationCredentials,
} from './olist-integration-config.service.js';
import { OlistAuthorizationService } from './olist-authorization.service.js';
import { OlistOAuthClient } from './olist-oauth.client.js';
import { OlistOAuthError } from './olist-oauth.types.js';

const ACCOUNT_A_ID = '20000000-0000-4000-8000-000000000001';
const ACCOUNT_B_ID = '20000000-0000-4000-8000-000000000002';
const CURRENT_ACCESS_TOKEN = 'olist-current-access';
const CURRENT_REFRESH_TOKEN = 'olist-current-refresh';

describe('OlistAuthorizationService', () => {
  it('returns SKIPPED outside both refresh margins', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        expiresAt: new Date(Date.now() + 11 * 60_000),
        refreshExpiresAt: new Date(Date.now() + 121 * 60_000),
      }),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const result = await service.refreshIfDue(ACCOUNT_A_ID);

    assert.equal(result.outcome, 'SKIPPED');
    assert.equal(oauth.refreshCalls.length, 0);
    assert.equal(
      await service.getAccessToken({ id: ACCOUNT_A_ID }),
      CURRENT_ACCESS_TOKEN,
    );
  });

  it('refreshes preventively when the refresh token has at most two hours left', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        expiresAt: new Date(Date.now() + 60 * 60_000),
        refreshExpiresAt: new Date(Date.now() + 90 * 60_000),
      }),
    ]);
    const oauth = new OAuthRefreshFake();

    const result = await makeService(
      database,
      encryption,
      oauth,
    ).refreshIfDue(ACCOUNT_A_ID);

    assert.equal(result.outcome, 'REFRESHED');
    assert.deepEqual(oauth.refreshCalls, [CURRENT_REFRESH_TOKEN]);
  });

  it('rotates access and refresh tokens and records successful timestamps', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        expiresAt: new Date(Date.now() + 9 * 60_000),
      }),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    assert.equal(
      await service.getAccessToken({ id: ACCOUNT_A_ID }),
      'new-access-1',
    );

    const stored = database.get(ACCOUNT_A_ID);
    assert.equal(encryption.decrypt(stored.accessTokenEncrypted), 'new-access-1');
    assert.equal(
      encryption.decrypt(stored.refreshTokenEncrypted),
      'new-refresh-1',
    );
    assert.equal(stored.status, 'ACTIVE');
    assert.equal(stored.statusReason, null);
    assert.ok(stored.lastRefreshAttemptAt);
    assert.ok(stored.lastRefreshSuccessAt);
  });

  it('keeps C1 and C2 refreshes independent', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        refreshToken: 'refresh-a',
        integrationKey: 'c1',
      }),
      storedAuthorization(encryption, ACCOUNT_B_ID, {
        refreshToken: 'refresh-b',
        integrationKey: 'c2',
      }),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const [resultA, resultB] = await Promise.all([
      service.refreshIfDue(ACCOUNT_A_ID),
      service.refreshIfDue(ACCOUNT_B_ID),
    ]);

    assert.equal(resultA.outcome, 'REFRESHED');
    assert.equal(resultB.outcome, 'REFRESHED');
    assert.deepEqual(oauth.refreshCalls.sort(), ['refresh-a', 'refresh-b']);
    assert.deepEqual(oauth.integrationKeys.sort(), ['c1', 'c2']);
  });

  it('coalesces concurrent refreshes in the same process', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const [first, second] = await Promise.all([
      service.refreshIfDue(ACCOUNT_A_ID),
      service.refreshIfDue(ACCOUNT_A_ID),
    ]);

    assert.equal(first.outcome, 'REFRESHED');
    assert.equal(second.outcome, 'REFRESHED');
    assert.equal(oauth.refreshCalls.length, 1);
  });

  it('serializes two processes and rereads after the advisory lock', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID),
    ]);
    const oauth = new OAuthRefreshFake();
    const firstProcess = makeService(database, encryption, oauth);
    const secondProcess = makeService(database, encryption, oauth);

    const [first, second] = await Promise.all([
      firstProcess.refreshIfDue(ACCOUNT_A_ID),
      secondProcess.refreshIfDue(ACCOUNT_A_ID),
    ]);

    assert.deepEqual(
      [first.outcome, second.outcome].sort(),
      ['REFRESHED', 'SKIPPED'],
    );
    assert.equal(oauth.refreshCalls.length, 1);
    assert.equal(database.lockCalls, 2);
  });

  it('marks an expired refresh token without making an HTTP request', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        refreshExpiresAt: new Date(Date.now() - 1),
      }),
    ]);
    const oauth = new OAuthRefreshFake();

    const result = await makeService(
      database,
      encryption,
      oauth,
    ).refreshIfDue(ACCOUNT_A_ID);

    assert.equal(result.outcome, 'REAUTH_REQUIRED');
    assert.equal(oauth.refreshCalls.length, 0);
    assert.equal(database.get(ACCOUNT_A_ID).status, 'REAUTH_REQUIRED');
    assert.equal(
      database.get(ACCOUNT_A_ID).statusReason,
      'refresh_token_expired',
    );
  });

  it('marks invalid_grant as REAUTH_REQUIRED and does not loop', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID),
    ]);
    const oauth = new OAuthRefreshFake([
      new OlistOAuthError(
        'INVALID_GRANT',
        'sensitive upstream response',
        'token_refresh',
        400,
      ),
    ]);
    const service = makeService(database, encryption, oauth);

    const first = await service.refreshIfDue(ACCOUNT_A_ID);
    const second = await service.refreshIfDue(ACCOUNT_A_ID);

    assert.equal(first.outcome, 'REAUTH_REQUIRED');
    assert.equal(second.outcome, 'REAUTH_REQUIRED');
    assert.equal(oauth.refreshCalls.length, 1);
    assert.equal(database.get(ACCOUNT_A_ID).statusReason, 'invalid_grant');
  });

  it('returns RETRY for timeout without requiring reauthorization', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID),
    ]);
    const oauth = new OAuthRefreshFake([
      new OlistOAuthError(
        'TIMEOUT',
        'request timed out',
        'token_refresh',
        null,
      ),
    ]);

    const result = await makeService(
      database,
      encryption,
      oauth,
    ).refreshIfDue(ACCOUNT_A_ID);

    assert.equal(result.outcome, 'RETRY');
    assert.equal(result.error, 'timeout');
    assert.equal(database.get(ACCOUNT_A_ID).status, 'ACTIVE');
    assert.ok(database.get(ACCOUNT_A_ID).lastRefreshAttemptAt);
    assert.equal(database.get(ACCOUNT_A_ID).lastRefreshSuccessAt, null);
  });

  it('retries only connection, 429 and 5xx failures', async () => {
    const cases: Array<{
      externalStatus: number | null;
      expectedOutcome: 'RETRY' | 'SKIPPED';
    }> = [
      { externalStatus: null, expectedOutcome: 'RETRY' },
      { externalStatus: 429, expectedOutcome: 'RETRY' },
      { externalStatus: 503, expectedOutcome: 'RETRY' },
      { externalStatus: 400, expectedOutcome: 'SKIPPED' },
      { externalStatus: 403, expectedOutcome: 'SKIPPED' },
    ];

    for (const { externalStatus, expectedOutcome } of cases) {
      const encryption = makeEncryption();
      const database = new AuthorizationDatabaseFake([
        storedAuthorization(encryption, ACCOUNT_A_ID),
      ]);
      const oauth = new OAuthRefreshFake([
        new OlistOAuthError(
          'REQUEST_FAILED',
          'sanitized by the service',
          'token_refresh',
          externalStatus,
        ),
      ]);

      const result = await makeService(
        database,
        encryption,
        oauth,
      ).refreshIfDue(ACCOUNT_A_ID);

      assert.equal(result.outcome, expectedOutcome);
      assert.equal(database.get(ACCOUNT_A_ID).status, 'ACTIVE');
    }
  });

  it('never includes tokens, client secret or OAuth response details in logs', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID),
    ]);
    const oauth = new OAuthRefreshFake([
      new OlistOAuthError(
        'TIMEOUT',
        `leaked ${CURRENT_ACCESS_TOKEN} ${CURRENT_REFRESH_TOKEN} c2-client-secret`,
        'token_refresh',
        null,
      ),
    ]);
    const service = makeService(database, encryption, oauth);
    const logs: string[] = [];
    (
      service as unknown as { logger: { log: (message: string) => void } }
    ).logger = { log: (message) => logs.push(message) };

    await service.refreshIfDue(ACCOUNT_A_ID);

    const serialized = logs.join('\n');
    assert.equal(serialized.includes(CURRENT_ACCESS_TOKEN), false);
    assert.equal(serialized.includes(CURRENT_REFRESH_TOKEN), false);
    assert.equal(serialized.includes('c2-client-secret'), false);
    assert.equal(serialized.includes('leaked'), false);
    assert.equal(serialized.includes('"integrationKey":"c2"'), true);
    assert.equal(serialized.includes('"result":"RETRY"'), true);
  });
});

type AuthorizationStatus = 'ACTIVE' | 'REAUTH_REQUIRED';

interface StoredAuthorization {
  integrationKey: string;
  olistAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
  status: AuthorizationStatus;
  statusReason: string | null;
  lastRefreshAttemptAt: Date | null;
  lastRefreshSuccessAt: Date | null;
}

class AuthorizationDatabaseFake {
  private transactionTail = Promise.resolve();
  lockCalls = 0;

  constructor(private readonly authorizations: StoredAuthorization[]) {}

  readonly olistAuthorization = {
    findUnique: async (args: {
      where: { olistAccountId: string };
    }): Promise<StoredAuthorization | null> => this.find(args.where.olistAccountId),
  };

  readonly $transaction = async <T>(
    operation: (transaction: unknown) => Promise<T>,
  ): Promise<T> => {
    const previous = this.transactionTail;
    let release = (): void => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(this.transactionClient());
    } finally {
      release();
    }
  };

  get(olistAccountId: string): StoredAuthorization {
    const authorization = this.find(olistAccountId);
    assert.ok(authorization);
    return authorization;
  }

  private find(olistAccountId: string): StoredAuthorization | null {
    return (
      this.authorizations.find(
        (candidate) => candidate.olistAccountId === olistAccountId,
      ) ?? null
    );
  }

  private transactionClient(): object {
    return {
      $executeRaw: async (): Promise<number> => {
        this.lockCalls += 1;
        return 1;
      },
      olistAuthorization: {
        findUnique: this.olistAuthorization.findUnique,
        update: async (args: {
          where: { olistAccountId: string };
          data: Partial<StoredAuthorization>;
        }): Promise<StoredAuthorization> => {
          const authorization = this.get(args.where.olistAccountId);
          Object.assign(authorization, args.data);
          return authorization;
        },
      },
    };
  }
}

class OAuthRefreshFake {
  readonly refreshCalls: string[] = [];
  readonly integrationKeys: string[] = [];

  constructor(private readonly errors: Error[] = []) {}

  async refreshAccessToken(
    credentials: OlistIntegrationCredentials,
    refreshToken: string,
  ) {
    this.integrationKeys.push(credentials.integrationKey);
    this.refreshCalls.push(refreshToken);
    await Promise.resolve();
    const error = this.errors.shift();
    if (error) throw error;
    const suffix = this.refreshCalls.length;
    return {
      accessToken: `new-access-${suffix}`,
      refreshToken: `new-refresh-${suffix}`,
      tokenType: 'Bearer',
      scope: 'openid',
      expiresIn: 14_400,
      refreshExpiresIn: 86_400,
    };
  }
}

function makeService(
  database: AuthorizationDatabaseFake,
  encryption: TokenEncryptionService,
  oauth: OAuthRefreshFake,
): OlistAuthorizationService {
  const config = makeConfig();
  return new OlistAuthorizationService(
    database as unknown as DatabaseService,
    encryption,
    new OlistIntegrationConfigService(
      config as unknown as ConfigService<Record<string, unknown>, false>,
    ),
    oauth as unknown as OlistOAuthClient,
  );
}

function storedAuthorization(
  encryption: TokenEncryptionService,
  olistAccountId: string,
  overrides: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
    refreshExpiresAt?: Date | null;
    integrationKey?: string;
  } = {},
): StoredAuthorization {
  return {
    integrationKey: overrides.integrationKey ?? 'c2',
    olistAccountId,
    accessTokenEncrypted: encryption.encrypt(
      overrides.accessToken ?? CURRENT_ACCESS_TOKEN,
    ),
    refreshTokenEncrypted: encryption.encrypt(
      overrides.refreshToken ?? CURRENT_REFRESH_TOKEN,
    ),
    tokenType: 'Bearer',
    scope: 'openid',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() - 60_000),
    refreshExpiresAt:
      overrides.refreshExpiresAt ?? new Date(Date.now() + 24 * 60 * 60_000),
    status: 'ACTIVE',
    statusReason: null,
    lastRefreshAttemptAt: null,
    lastRefreshSuccessAt: null,
  };
}

function makeEncryption(): TokenEncryptionService {
  return new TokenEncryptionService(makeConfig());
}

function makeConfig(): ConfigService<EnvironmentVariables, true> {
  const values: Record<string, string> = {
    OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
    OLIST_INTEGRATION_KEYS: 'c1,c2',
    OLIST_DEFAULT_INTEGRATION_KEY: 'c2',
    OLIST_C1_CLIENT_ID: 'c1-client-id',
    OLIST_C1_CLIENT_SECRET: 'c1-client-secret',
    OLIST_C1_REDIRECT_URI: 'https://c1.example.test/callback',
    OLIST_C2_CLIENT_ID: 'c2-client-id',
    OLIST_C2_CLIENT_SECRET: 'c2-client-secret',
    OLIST_C2_REDIRECT_URI: 'https://c2.example.test/callback',
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) throw new Error(`Missing test config: ${key}`);
      return value;
    },
  } as unknown as ConfigService<EnvironmentVariables, true>;
}
