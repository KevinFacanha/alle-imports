import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace, MarketplaceAccount } from '@prisma/client';

import { EnvironmentVariables } from '../../../../config/environment.validation.js';
import { DatabaseService } from '../../../../database/database.service.js';
import { MercadoLivreOAuthClient } from './mercado-livre-oauth.client.js';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service.js';
import { OAuthStateStore } from './oauth-state.store.js';
import { TokenEncryptionService } from './token-encryption.service.js';

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const REDIRECT_URI =
  'https://example.test/api/v1/auth/mercado-livre/callback';
const ACCESS_TOKEN = 'secret-access-token';
const REFRESH_TOKEN = 'secret-refresh-token';

describe('OAuthStateStore', () => {
  it('generates a secure state and an RFC 7636 S256 challenge', () => {
    const store = new OAuthStateStore();
    const first = store.create();
    const second = store.create();

    assert.notEqual(first.state, second.state);
    assert.match(first.state, /^[\w-]{43}$/);
    assert.ok(first.codeVerifier.length >= 43);
    assert.ok(first.codeVerifier.length <= 128);
    assert.equal(
      first.codeChallenge,
      createHash('sha256')
        .update(first.codeVerifier, 'ascii')
        .digest('base64url'),
    );
    assert.equal(store.consume(first.state), first.codeVerifier);
    assert.throws(() => store.consume(first.state), /invalid or expired/);
  });

  it('rejects an invalid or expired state', () => {
    const store = new OAuthStateStore();
    const authorization = store.create(1_000);

    assert.throws(() => store.consume('unknown', 1_001));
    assert.throws(() =>
      store.consume(authorization.state, authorization.expiresAt.getTime()),
    );
  });
});

describe('MercadoLivre OAuth flow', () => {
  it('builds the official authorization URL with state and PKCE', () => {
    const { oauthClient } = makeOAuthClient([]);
    const url = new URL(
      oauthClient.createAuthorizationUrl('state-value', 'challenge-value'),
    );

    assert.equal(url.origin, 'https://auth.mercadolivre.com.br');
    assert.equal(url.pathname, '/authorization');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
    assert.equal(url.searchParams.get('state'), 'state-value');
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.toString().includes(CLIENT_SECRET), false);
  });

  it('exchanges the code, calls /users/me and creates an encrypted account authorization', async () => {
    const database = new OAuthDatabaseFake();
    const { service, calls, encryption } = makeOAuthService(database, [
      jsonResponse(tokenResponse()),
      jsonResponse({ id: 123456, nickname: 'seller-one' }),
    ]);
    const state = extractState(service.createAuthorizationUrl());

    const result = await service.handleCallback(state, 'authorization-code');

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url.pathname, '/oauth/token');
    assert.equal(calls[0]?.init.method, 'POST');
    const tokenBody = calls[0]?.init.body;
    assert.ok(tokenBody instanceof URLSearchParams);
    assert.equal(tokenBody.get('grant_type'), 'authorization_code');
    assert.equal(tokenBody.get('code'), 'authorization-code');
    assert.ok(tokenBody.get('code_verifier'));
    assert.equal(calls[1]?.url.pathname, '/users/me');
    assert.equal(
      new Headers(calls[1]?.init.headers).get('authorization'),
      `Bearer ${ACCESS_TOKEN}`,
    );

    assert.deepEqual(result, {
      connected: true,
      marketplaceAccount: {
        id: database.accounts[0]?.id,
        externalAccountId: '123456',
        name: 'seller-one',
      },
    });
    assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(result).includes(REFRESH_TOKEN), false);
    assert.equal(database.accounts[0]?.marketplace, Marketplace.MERCADO_LIVRE);
    assert.equal(database.authorizations.length, 1);
    const authorization = database.authorizations[0];
    assert.ok(authorization);
    assert.notEqual(authorization.accessTokenEncrypted, ACCESS_TOKEN);
    assert.notEqual(authorization.refreshTokenEncrypted, REFRESH_TOKEN);
    assert.equal(
      encryption.decrypt(authorization.accessTokenEncrypted),
      ACCESS_TOKEN,
    );
    assert.equal(
      encryption.decrypt(authorization.refreshTokenEncrypted),
      REFRESH_TOKEN,
    );
  });

  it('rejects an invalid state before making an external request', async () => {
    const database = new OAuthDatabaseFake();
    const { service, calls } = makeOAuthService(database, []);

    await assert.rejects(
      service.handleCallback('invalid-state', 'authorization-code'),
      BadRequestException,
    );
    assert.equal(calls.length, 0);
  });

  it('rejects reuse of an already consumed state', async () => {
    const database = new OAuthDatabaseFake();
    const { service, calls } = makeOAuthService(database, [
      jsonResponse(tokenResponse()),
      jsonResponse({ id: 123456, nickname: 'seller-one' }),
    ]);
    const state = extractState(service.createAuthorizationUrl());

    await service.handleCallback(state, 'authorization-code');
    await assert.rejects(
      service.handleCallback(state, 'authorization-code'),
      BadRequestException,
    );
    assert.equal(calls.length, 2);
  });

  it('returns a sanitized invalid_grant error without leaking tokens', async () => {
    const leakedValue = 'upstream-secret-that-must-not-leak';
    const database = new OAuthDatabaseFake();
    const { service } = makeOAuthService(database, [
      jsonResponse(
        {
          error: 'invalid_grant',
          error_description: `invalid ${leakedValue}`,
        },
        400,
      ),
    ]);
    const state = extractState(service.createAuthorizationUrl());

    await assert.rejects(
      service.handleCallback(state, 'authorization-code'),
      (error: unknown) => {
        assert.ok(error instanceof BadGatewayException);
        assert.equal(error.message.includes(leakedValue), false);
        assert.equal(JSON.stringify(error.getResponse()).includes(leakedValue), false);
        return true;
      },
    );
  });

  it('keeps two Mercado Livre accounts and authorizations independent', async () => {
    const database = new OAuthDatabaseFake();
    const first = makeOAuthService(database, [
      jsonResponse(
        tokenResponse({
          access_token: 'access-account-a',
          refresh_token: 'refresh-account-a',
        }),
      ),
      jsonResponse({ id: 1001, nickname: 'account-a' }),
    ]);
    const second = makeOAuthService(database, [
      jsonResponse(
        tokenResponse({
          access_token: 'access-account-b',
          refresh_token: 'refresh-account-b',
        }),
      ),
      jsonResponse({ id: 2002, nickname: 'account-b' }),
    ]);

    await first.service.handleCallback(
      extractState(first.service.createAuthorizationUrl()),
      'code-a',
    );
    await second.service.handleCallback(
      extractState(second.service.createAuthorizationUrl()),
      'code-b',
    );

    assert.deepEqual(
      database.accounts.map((account) => account.externalAccountId).sort(),
      ['1001', '2002'],
    );
    assert.equal(database.authorizations.length, 2);
    const encryptedTokens = database.authorizations.map(
      (authorization) => authorization.accessTokenEncrypted,
    );
    assert.equal(
      encryptedTokens.some((token) => token.includes('access-account')),
      false,
    );
  });
});

interface FetchCall {
  url: URL;
  init: RequestInit;
}

interface StoredAuthorization {
  marketplaceAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date;
}

class OAuthDatabaseFake {
  readonly accounts: MarketplaceAccount[] = [];
  readonly authorizations: StoredAuthorization[] = [];

  readonly $transaction = async <T>(
    operation: (transaction: unknown) => Promise<T>,
  ): Promise<T> => operation(this.transactionClient());

  private transactionClient(): object {
    return {
      marketplaceAccount: {
        upsert: async (args: {
          where: {
            marketplace_externalAccountId: {
              marketplace: Marketplace;
              externalAccountId: string;
            };
          };
          create: {
            marketplace: Marketplace;
            externalAccountId: string;
            name: string;
            active: boolean;
          };
          update: { name: string; active: boolean };
        }): Promise<MarketplaceAccount> => {
          const identity = args.where.marketplace_externalAccountId;
          const existing = this.accounts.find(
            (account) =>
              account.marketplace === identity.marketplace &&
              account.externalAccountId === identity.externalAccountId,
          );
          if (existing) {
            existing.name = args.update.name;
            existing.active = args.update.active;
            return existing;
          }

          const account: MarketplaceAccount = {
            id: `00000000-0000-4000-8000-${String(this.accounts.length + 1).padStart(12, '0')}`,
            ...args.create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.accounts.push(account);
          return account;
        },
      },
      marketplaceAuthorization: {
        upsert: async (args: {
          where: { marketplaceAccountId: string };
          create: StoredAuthorization;
          update: Omit<StoredAuthorization, 'marketplaceAccountId'>;
        }): Promise<StoredAuthorization> => {
          const existingIndex = this.authorizations.findIndex(
            (authorization) =>
              authorization.marketplaceAccountId ===
              args.where.marketplaceAccountId,
          );
          const authorization =
            existingIndex >= 0
              ? {
                  marketplaceAccountId: args.where.marketplaceAccountId,
                  ...args.update,
                }
              : args.create;
          if (existingIndex >= 0) {
            this.authorizations[existingIndex] = authorization;
          } else {
            this.authorizations.push(authorization);
          }
          return authorization;
        },
      },
    };
  }
}

function makeOAuthService(
  database: OAuthDatabaseFake,
  responses: Response[],
): {
  service: MercadoLivreOAuthService;
  oauthClient: MercadoLivreOAuthClient;
  encryption: TokenEncryptionService;
  calls: FetchCall[];
} {
  const { oauthClient, calls, config } = makeOAuthClient(responses);
  const encryption = new TokenEncryptionService(config);
  return {
    service: new MercadoLivreOAuthService(
      new OAuthStateStore(),
      oauthClient,
      encryption,
      database as unknown as DatabaseService,
    ),
    oauthClient,
    encryption,
    calls,
  };
}

function makeOAuthClient(responses: Response[]): {
  oauthClient: MercadoLivreOAuthClient;
  calls: FetchCall[];
  config: ConfigService<EnvironmentVariables, true>;
} {
  const calls: FetchCall[] = [];
  let responseIndex = 0;
  const fetchMock = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    const response = responses[responseIndex];
    responseIndex += 1;
    if (!response) {
      throw new Error('Unexpected fetch call in test.');
    }
    return response;
  }) as typeof fetch;
  const config = makeConfig();

  return {
    oauthClient: new MercadoLivreOAuthClient(
      config,
      fetchMock,
      1_000,
    ),
    calls,
    config,
  };
}

function makeConfig(): ConfigService<EnvironmentVariables, true> {
  const values: Partial<Record<keyof EnvironmentVariables, string>> = {
    MELI_CLIENT_ID: CLIENT_ID,
    MELI_CLIENT_SECRET: CLIENT_SECRET,
    MELI_REDIRECT_URI: REDIRECT_URI,
    OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  return {
    getOrThrow: (key: keyof EnvironmentVariables) => {
      const value = values[key];
      if (!value) {
        throw new Error(`Missing test config: ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function extractState(authorizationUrl: string): string {
  const state = new URL(authorizationUrl).searchParams.get('state');
  assert.ok(state);
  return state;
}

function tokenResponse(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expires_in: 21_600,
    token_type: 'bearer',
    scope: 'offline_access read write',
    user_id: 123456,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
