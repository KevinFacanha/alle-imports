import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../../config/environment.validation.js';
import { DatabaseService } from '../../../../database/database.service.js';
import { MercadoLivreOAuthClient } from './mercado-livre-oauth.client.js';
import { MercadoLivreOAuthError } from './mercado-livre-oauth.types.js';
import { MarketplaceAuthorizationService } from './marketplace-authorization.service.js';
import {
  TokenEncryptionError,
  TokenEncryptionService,
} from './token-encryption.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const CURRENT_ACCESS_TOKEN = 'current-secret-access-token';
const CURRENT_REFRESH_TOKEN = 'current-secret-refresh-token';
const NEW_ACCESS_TOKEN = 'new-secret-access-token';
const NEW_REFRESH_TOKEN = 'new-secret-refresh-token';

describe('TokenEncryptionService', () => {
  it('encrypts and decrypts tokens with AES-256-GCM', () => {
    const encryption = makeEncryption();
    const first = encryption.encrypt(CURRENT_ACCESS_TOKEN);
    const second = encryption.encrypt(CURRENT_ACCESS_TOKEN);

    assert.notEqual(first, CURRENT_ACCESS_TOKEN);
    assert.notEqual(first, second);
    assert.equal(encryption.decrypt(first), CURRENT_ACCESS_TOKEN);
    assert.equal(encryption.decrypt(second), CURRENT_ACCESS_TOKEN);
  });

  it('rejects a tampered ciphertext', () => {
    const encryption = makeEncryption();
    const encrypted = encryption.encrypt(CURRENT_ACCESS_TOKEN);
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

    assert.throws(
      () => encryption.decrypt(tampered),
      TokenEncryptionError,
    );
  });
});

describe('MarketplaceAuthorizationService', () => {
  it('does not refresh a token that is still valid', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake(
      makeAuthorization(encryption, Date.now() + 10 * 60_000),
    );
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const accessToken = await service.getAccessToken({ id: ACCOUNT_ID });

    assert.equal(accessToken, CURRENT_ACCESS_TOKEN);
    assert.equal(oauth.refreshCalls.length, 0);
    assert.equal(database.updateCount, 0);
  });

  it('refreshes an expired token and persists both rotated tokens transactionally', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake(
      makeAuthorization(encryption, Date.now() - 1_000),
    );
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const accessToken = await service.getAccessToken({ id: ACCOUNT_ID });

    assert.equal(accessToken, NEW_ACCESS_TOKEN);
    assert.deepEqual(oauth.refreshCalls, [CURRENT_REFRESH_TOKEN]);
    assert.equal(database.updateCount, 1);
    assert.equal(
      encryption.decrypt(database.authorization.accessTokenEncrypted),
      NEW_ACCESS_TOKEN,
    );
    assert.equal(
      encryption.decrypt(database.authorization.refreshTokenEncrypted),
      NEW_REFRESH_TOKEN,
    );
    assert.ok(database.authorization.expiresAt.getTime() > Date.now());
  });

  it('surfaces invalid_grant as a sanitized error and keeps stored tokens unchanged', async () => {
    const encryption = makeEncryption();
    const original = makeAuthorization(encryption, Date.now() - 1_000);
    const database = new AuthorizationDatabaseFake(original);
    const oauth = new OAuthRefreshFake(
      new MercadoLivreOAuthError(
        'INVALID_GRANT',
        'Mercado Livre authorization grant is invalid or expired.',
      ),
    );
    const service = makeService(database, encryption, oauth);

    await assert.rejects(
      service.getAccessToken({ id: ACCOUNT_ID }),
      (error: unknown) => {
        assert.ok(error instanceof MercadoLivreOAuthError);
        assert.equal(error.code, 'INVALID_GRANT');
        assert.equal(error.message.includes(CURRENT_REFRESH_TOKEN), false);
        return true;
      },
    );
    assert.equal(database.updateCount, 0);
    assert.equal(
      encryption.decrypt(database.authorization.refreshTokenEncrypted),
      CURRENT_REFRESH_TOKEN,
    );
  });

  it('coalesces simultaneous refreshes for the same account', async () => {
    const encryption = makeEncryption();
    const database = new AuthorizationDatabaseFake(
      makeAuthorization(encryption, Date.now() - 1_000),
    );
    const oauth = new OAuthRefreshFake();
    const service = makeService(database, encryption, oauth);

    const [first, second] = await Promise.all([
      service.getAccessToken({ id: ACCOUNT_ID }),
      service.getAccessToken({ id: ACCOUNT_ID }),
    ]);

    assert.equal(first, NEW_ACCESS_TOKEN);
    assert.equal(second, NEW_ACCESS_TOKEN);
    assert.equal(oauth.refreshCalls.length, 1);
    assert.equal(database.transactionCount, 1);
    assert.equal(database.updateCount, 1);
  });
});

interface StoredAuthorization {
  marketplaceAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date;
}

class AuthorizationDatabaseFake {
  transactionCount = 0;
  updateCount = 0;

  constructor(readonly authorization: StoredAuthorization) {}

  readonly $transaction = async <T>(
    operation: (transaction: unknown) => Promise<T>,
  ): Promise<T> => {
    this.transactionCount += 1;
    return operation({
      $queryRaw: async (): Promise<unknown[]> => [],
      marketplaceAuthorization: {
        findUnique: async (): Promise<StoredAuthorization | null> =>
          this.authorization,
        update: async (args: {
          data: Omit<StoredAuthorization, 'marketplaceAccountId'>;
        }): Promise<StoredAuthorization> => {
          this.updateCount += 1;
          Object.assign(this.authorization, args.data);
          return this.authorization;
        },
      },
    });
  };
}

class OAuthRefreshFake {
  readonly refreshCalls: string[] = [];

  constructor(private readonly error?: Error) {}

  async refreshAccessToken(refreshToken: string) {
    this.refreshCalls.push(refreshToken);
    await Promise.resolve();
    if (this.error) {
      throw this.error;
    }
    return {
      accessToken: NEW_ACCESS_TOKEN,
      refreshToken: NEW_REFRESH_TOKEN,
      tokenType: 'bearer',
      scope: 'offline_access read write',
      expiresIn: 21_600,
    };
  }
}

function makeService(
  database: AuthorizationDatabaseFake,
  encryption: TokenEncryptionService,
  oauth: OAuthRefreshFake,
): MarketplaceAuthorizationService {
  return new MarketplaceAuthorizationService(
    database as unknown as DatabaseService,
    encryption,
    oauth as unknown as MercadoLivreOAuthClient,
  );
}

function makeAuthorization(
  encryption: TokenEncryptionService,
  expiresAt: number,
): StoredAuthorization {
  return {
    marketplaceAccountId: ACCOUNT_ID,
    accessTokenEncrypted: encryption.encrypt(CURRENT_ACCESS_TOKEN),
    refreshTokenEncrypted: encryption.encrypt(CURRENT_REFRESH_TOKEN),
    tokenType: 'bearer',
    scope: 'offline_access read write',
    expiresAt: new Date(expiresAt),
  };
}

function makeEncryption(): TokenEncryptionService {
  return new TokenEncryptionService({
    getOrThrow: () => Buffer.alloc(32, 9).toString('base64'),
  } as unknown as ConfigService<EnvironmentVariables, true>);
}
