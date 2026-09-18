import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import { TokenEncryptionService } from '../oauth/token-encryption.service.js';
import {
  OlistAuthorizationService,
  OlistReauthorizationRequiredError,
} from './olist-authorization.service.js';
import { OlistOAuthClient } from './olist-oauth.client.js';

const ACCOUNT_A_ID = '20000000-0000-4000-8000-000000000001';
const ACCOUNT_B_ID = '20000000-0000-4000-8000-000000000002';
const CURRENT_ACCESS_TOKEN = 'olist-current-access';
const CURRENT_REFRESH_TOKEN = 'olist-current-refresh';

describe('OlistAuthorizationService', () => {
  it('returns a valid encrypted access token without refreshing', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        expiresAt: new Date(Date.now() + 10 * 60_000),
      }),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    assert.equal(
      await service.getAccessToken({ id: ACCOUNT_A_ID }),
      CURRENT_ACCESS_TOKEN,
    );
    assert.equal(oauth.refreshCalls.length, 0);
  });

  it('refreshes once, persists rotation and coalesces concurrent calls', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const [first, second] = await Promise.all([
      service.getAccessToken({ id: ACCOUNT_A_ID }),
      service.getAccessToken({ id: ACCOUNT_A_ID }),
    ]);

    assert.equal(first, 'new-access-1');
    assert.equal(second, 'new-access-1');
    assert.deepEqual(oauth.refreshCalls, [CURRENT_REFRESH_TOKEN]);
    const stored = database.get(ACCOUNT_A_ID);
    assert.equal(
      encryption.decrypt(stored.accessTokenEncrypted),
      'new-access-1',
    );
    assert.equal(
      encryption.decrypt(stored.refreshTokenEncrypted),
      'new-refresh-1',
    );
    assert.equal(stored.tokenType, 'Bearer');
    assert.equal(stored.scope, 'openid');
    assert.ok(stored.expiresAt.getTime() > Date.now());
    assert.ok(stored.refreshExpiresAt?.getTime());
  });

  it('refreshes separate accounts independently', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        refreshToken: 'refresh-a',
      }),
      storedAuthorization(encryption, ACCOUNT_B_ID, {
        refreshToken: 'refresh-b',
      }),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const [accessA, accessB] = await Promise.all([
      service.getAccessToken({ id: ACCOUNT_A_ID }),
      service.getAccessToken({ id: ACCOUNT_B_ID }),
    ]);

    assert.deepEqual([accessA, accessB].sort(), [
      'new-access-1',
      'new-access-2',
    ]);
    assert.deepEqual(oauth.refreshCalls.sort(), ['refresh-a', 'refresh-b']);
    assert.notEqual(
      database.get(ACCOUNT_A_ID).accessTokenEncrypted,
      database.get(ACCOUNT_B_ID).accessTokenEncrypted,
    );
  });

  it('requires reauthorization when the refresh token has expired', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake([
      storedAuthorization(encryption, ACCOUNT_A_ID, {
        refreshExpiresAt: new Date(Date.now() - 1),
      }),
    ]);
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    await assert.rejects(
      service.getAccessToken({ id: ACCOUNT_A_ID }),
      OlistReauthorizationRequiredError,
    );
    assert.equal(oauth.refreshCalls.length, 0);
  });
});

interface StoredAuthorization {
  olistAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
}

class AuthorizationDatabaseFake {
  constructor(private readonly authorizations: StoredAuthorization[]) {}

  readonly $transaction = async <T>(
    operation: (transaction: unknown) => Promise<T>,
  ): Promise<T> => operation(this.transactionClient());

  get(olistAccountId: string): StoredAuthorization {
    const authorization = this.authorizations.find(
      (candidate) => candidate.olistAccountId === olistAccountId,
    );
    assert.ok(authorization);
    return authorization;
  }

  private transactionClient(): object {
    return {
      $executeRaw: async (): Promise<number> => 1,
      olistAuthorization: {
        findUnique: async (args: {
          where: { olistAccountId: string };
        }): Promise<StoredAuthorization | null> =>
          this.authorizations.find(
            (authorization) =>
              authorization.olistAccountId === args.where.olistAccountId,
          ) ?? null,
        update: async (args: {
          where: { olistAccountId: string };
          data: Omit<StoredAuthorization, 'olistAccountId'>;
        }): Promise<StoredAuthorization> => {
          const index = this.authorizations.findIndex(
            (authorization) =>
              authorization.olistAccountId === args.where.olistAccountId,
          );
          assert.ok(index >= 0);
          const updated = {
            olistAccountId: args.where.olistAccountId,
            ...args.data,
          };
          this.authorizations[index] = updated;
          return updated;
        },
      },
    };
  }
}

class OAuthRefreshFake {
  readonly refreshCalls: string[] = [];

  async refreshAccessToken(refreshToken: string) {
    this.refreshCalls.push(refreshToken);
    const suffix = this.refreshCalls.length;
    await Promise.resolve();
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
  return new OlistAuthorizationService(
    database as unknown as DatabaseService,
    encryption,
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
  } = {},
): StoredAuthorization {
  return {
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
      overrides.refreshExpiresAt ?? new Date(Date.now() + 60 * 60_000),
  };
}

function makeEncryption(): TokenEncryptionService {
  const values: Partial<Record<keyof EnvironmentVariables, string>> = {
    OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  };
  const config = {
    getOrThrow: (key: keyof EnvironmentVariables) => {
      const value = values[key];
      if (!value) {
        throw new Error(`Missing test config: ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new TokenEncryptionService(config);
}
