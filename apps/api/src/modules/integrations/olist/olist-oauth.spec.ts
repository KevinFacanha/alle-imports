import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OlistAccount } from '@prisma/client';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import { DatabaseService } from '../../../database/database.service.js';
import { OAuthStateStore } from '../oauth/oauth-state.store.js';
import { TokenEncryptionService } from '../oauth/token-encryption.service.js';
import {
  OlistIntegrationConfigService,
  OlistIntegrationCredentials,
  OlistIntegrationNotConfiguredError,
} from './olist-integration-config.service.js';
import { OlistOAuthClient } from './olist-oauth.client.js';
import { OlistOAuthService } from './olist-oauth.service.js';

const CLIENT_ID = 'olist-test-client-id';
const CLIENT_SECRET = 'olist-test-client-secret';
const REDIRECT_URI = 'https://example.test/api/v1/auth/olist/callback';
const C1_CLIENT_ID = 'olist-c1-test-client-id';
const C1_CLIENT_SECRET = 'olist-c1-test-client-secret';
const C1_REDIRECT_URI = 'https://c1.example.test/api/v1/auth/olist/callback';
const ACCESS_TOKEN = 'olist-secret-access-token';
const REFRESH_TOKEN = 'olist-secret-refresh-token';
const C2_CREDENTIALS: OlistIntegrationCredentials = {
  integrationKey: 'c2',
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
};

describe('Olist OAuth state', () => {
  it('generates an unpredictable state and an RFC 7636 S256 challenge', () => {
    const store = new OAuthStateStore();
    const first = store.create('olist');
    const second = store.create('olist');

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
  });

  it('rejects an invalid state', () => {
    const store = new OAuthStateStore();

    assert.throws(
      () => store.consume('unknown', 'olist'),
      /invalid or expired/,
    );
  });

  it('rejects an expired state', () => {
    const store = new OAuthStateStore();
    const authorization = store.create('olist', 1_000);

    assert.throws(() =>
      store.consume(
        authorization.state,
        'olist',
        authorization.expiresAt.getTime(),
      ),
    );
  });

  it('allows a state to be consumed only once and only by Olist', () => {
    const store = new OAuthStateStore();
    const authorization = store.create('olist');

    assert.equal(
      store.consume(authorization.state, 'olist'),
      authorization.codeVerifier,
    );
    assert.throws(() => store.consume(authorization.state, 'olist'));

    const providerBound = store.create('olist');
    assert.throws(() =>
      store.consume(providerBound.state, 'mercado-livre'),
    );
  });

  it('returns the integration binding only when consuming the state', () => {
    const store = new OAuthStateStore();
    const authorization = store.createBound('olist', 'c1');

    assert.deepEqual(store.consumeBound(authorization.state, 'olist'), {
      codeVerifier: authorization.codeVerifier,
      integrationKey: 'c1',
    });
    assert.throws(() => store.consumeBound(authorization.state, 'olist'));
  });
});

describe('Olist integration configuration', () => {
  it('keeps the existing Conta 2 variables working as a legacy fallback', () => {
    const resolver = makeIntegrationConfig({
      OLIST_CLIENT_ID: CLIENT_ID,
      OLIST_CLIENT_SECRET: CLIENT_SECRET,
      OLIST_REDIRECT_URI: REDIRECT_URI,
    });

    assert.deepEqual(resolver.resolve(), C2_CREDENTIALS);
  });

  it('selects C1 and C2 credentials by configured integration key', () => {
    const resolver = makeIntegrationConfig(integrationConfigValues());

    assert.equal(resolver.resolve('c1').clientId, C1_CLIENT_ID);
    assert.equal(resolver.resolve('c1').clientSecret, C1_CLIENT_SECRET);
    assert.equal(resolver.resolve('c2').clientId, CLIENT_ID);
    assert.equal(resolver.resolve('c2').clientSecret, CLIENT_SECRET);
  });

  it('rejects an unknown or incomplete integration without exposing secrets', () => {
    const resolver = makeIntegrationConfig(integrationConfigValues());

    assert.throws(
      () => resolver.resolve('missing'),
      (error: unknown) => {
        assert.ok(error instanceof OlistIntegrationNotConfiguredError);
        const serialized = JSON.stringify(error);
        assert.equal(serialized.includes(CLIENT_SECRET), false);
        assert.equal(serialized.includes(C1_CLIENT_SECRET), false);
        return true;
      },
    );
  });
});

describe('Olist OAuth flow', () => {
  it('builds the official authorization URL with state and PKCE', () => {
    const { oauthClient } = makeOAuthClient([]);
    const url = new URL(
      oauthClient.createAuthorizationUrl(
        C2_CREDENTIALS,
        'state-value',
        'challenge-value',
      ),
    );

    assert.equal(url.origin, 'https://accounts.tiny.com.br');
    assert.equal(
      url.pathname,
      '/realms/tiny/protocol/openid-connect/auth',
    );
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
    assert.equal(url.searchParams.get('scope'), 'openid');
    assert.equal(url.searchParams.get('state'), 'state-value');
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.toString().includes(CLIENT_SECRET), false);
  });

  it('rejects a callback without code after consuming its state', async () => {
    const database = new OlistOAuthDatabaseFake();
    const { service, calls } = makeOAuthService(database, []);
    const state = extractState(service.createAuthorizationUrl());

    await assert.rejects(
      service.handleCallback(state, undefined),
      BadRequestException,
    );
    await assert.rejects(
      service.handleCallback(state, 'code-after-retry'),
      BadRequestException,
    );
    assert.equal(calls.length, 0);
  });

  it('recovers C1 from state and uses only its credentials in callback', async () => {
    const database = new OlistOAuthDatabaseFake();
    const { service, calls } = makeOAuthService(database, [
      jsonResponse(tokenResponse()),
      jsonResponse({
        razaoSocial: 'Conta 1 Ltda',
        cpfCnpj: '33.333.333/0001-91',
      }),
    ]);
    const authorizationUrl = new URL(service.createAuthorizationUrl('c1'));
    const state = authorizationUrl.searchParams.get('state');
    assert.ok(state);
    assert.equal(authorizationUrl.searchParams.get('client_id'), C1_CLIENT_ID);
    assert.equal(
      authorizationUrl.searchParams.get('redirect_uri'),
      C1_REDIRECT_URI,
    );

    await service.handleCallback(state, 'c1-authorization-code');

    const tokenBody = calls[0]?.init.body;
    assert.ok(tokenBody instanceof URLSearchParams);
    assert.equal(tokenBody.get('client_id'), C1_CLIENT_ID);
    assert.equal(tokenBody.get('client_secret'), C1_CLIENT_SECRET);
    assert.equal(database.authorizations[0]?.integrationKey, 'c1');
  });

  it('rejects an unconfigured integration before creating state or redirecting', () => {
    const database = new OlistOAuthDatabaseFake();
    const { service, calls } = makeOAuthService(database, []);

    assert.throws(
      () => service.createAuthorizationUrl('unknown'),
      BadRequestException,
    );
    assert.equal(calls.length, 0);
  });

  it('exchanges the code, identifies /info and stores encrypted tokens', async () => {
    const database = new OlistOAuthDatabaseFake();
    const { service, calls, encryption } = makeOAuthService(database, [
      jsonResponse(tokenResponse()),
      jsonResponse({
        razaoSocial: 'Ale Comercio Ltda',
        fantasia: 'Ale Store',
        cpfCnpj: '12.345.678/0001-95',
      }),
    ]);
    const state = extractState(service.createAuthorizationUrl());

    const result = await service.handleCallback(state, 'authorization-code');

    assert.equal(calls.length, 2);
    assert.equal(
      calls[0]?.url.pathname,
      '/realms/tiny/protocol/openid-connect/token',
    );
    const tokenBody = calls[0]?.init.body;
    assert.ok(tokenBody instanceof URLSearchParams);
    assert.equal(tokenBody.get('grant_type'), 'authorization_code');
    assert.equal(tokenBody.get('code'), 'authorization-code');
    assert.equal(tokenBody.get('client_secret'), CLIENT_SECRET);
    assert.ok(tokenBody.get('code_verifier'));
    assert.equal(calls[1]?.url.pathname, '/public-api/v3/info');
    assert.equal(
      new Headers(calls[1]?.init.headers).get('authorization'),
      `Bearer ${ACCESS_TOKEN}`,
    );

    assert.deepEqual(result, {
      connected: true,
      olistAccount: {
        id: database.accounts[0]?.id,
        name: 'Ale Store',
      },
    });
    assert.equal(JSON.stringify(result).includes('12345678000195'), false);
    assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify(result).includes(REFRESH_TOKEN), false);
    assert.equal(database.accounts[0]?.externalAccountId, '12345678000195');

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
    assert.equal(authorization.tokenType, 'Bearer');
    assert.equal(authorization.scope, 'openid');
    assert.ok(authorization.expiresAt.getTime() > Date.now());
    assert.ok(authorization.refreshExpiresAt?.getTime());
  });

  it('rejects an invalid state before making an external request', async () => {
    const database = new OlistOAuthDatabaseFake();
    const { service, calls } = makeOAuthService(database, []);

    await assert.rejects(
      service.handleCallback('invalid-state', 'authorization-code'),
      BadRequestException,
    );
    assert.equal(calls.length, 0);
  });

  it('sanitizes upstream OAuth errors without leaking secrets', async () => {
    const leakedValue = 'upstream-sensitive-detail';
    const database = new OlistOAuthDatabaseFake();
    const { service } = makeOAuthService(database, [
      jsonResponse(
        {
          error: 'invalid_grant',
          error_description: `${leakedValue} ${ACCESS_TOKEN}`,
        },
        400,
      ),
    ]);
    const state = extractState(service.createAuthorizationUrl());

    await assert.rejects(
      service.handleCallback(state, 'authorization-code'),
      (error: unknown) => {
        assert.ok(error instanceof BadGatewayException);
        const serialized = JSON.stringify(error.getResponse());
        assert.equal(serialized.includes(leakedValue), false);
        assert.equal(serialized.includes(ACCESS_TOKEN), false);
        assert.equal(serialized.includes(REFRESH_TOKEN), false);
        assert.equal(serialized.includes(CLIENT_SECRET), false);
        assert.equal(serialized.includes('token_exchange'), true);
        assert.equal(serialized.includes('400'), true);
        assert.equal(serialized.includes('invalid_grant'), true);
        return true;
      },
    );
  });

  it('identifies an unauthorized /info request without leaking tokens', async () => {
    const database = new OlistOAuthDatabaseFake();
    const { service } = makeOAuthService(database, [
      jsonResponse(tokenResponse()),
      jsonResponse({ message: `unauthorized ${ACCESS_TOKEN}` }, 401),
    ]);
    const state = extractState(service.createAuthorizationUrl());

    await assert.rejects(
      service.handleCallback(state, 'authorization-code'),
      (error: unknown) => {
        assert.ok(error instanceof BadGatewayException);
        const serialized = JSON.stringify(error.getResponse());
        assert.equal(serialized.includes('account_info'), true);
        assert.equal(serialized.includes('401'), true);
        assert.equal(serialized.includes('request_failed'), true);
        assert.equal(serialized.includes(ACCESS_TOKEN), false);
        assert.equal(serialized.includes(REFRESH_TOKEN), false);
        assert.equal(serialized.includes(CLIENT_SECRET), false);
        return true;
      },
    );
    assert.equal(database.accounts.length, 0);
    assert.equal(database.authorizations.length, 0);
  });

  it('keeps two Olist accounts and authorizations isolated', async () => {
    const database = new OlistOAuthDatabaseFake();
    const first = makeOAuthService(database, [
      jsonResponse(
        tokenResponse({
          access_token: 'access-account-a',
          refresh_token: 'refresh-account-a',
        }),
      ),
      jsonResponse({
        razaoSocial: 'Account A Ltda',
        cpfCnpj: '11.111.111/0001-91',
      }),
    ]);
    const second = makeOAuthService(database, [
      jsonResponse(
        tokenResponse({
          access_token: 'access-account-b',
          refresh_token: 'refresh-account-b',
        }),
      ),
      jsonResponse({
        razaoSocial: 'Account B Ltda',
        cpfCnpj: '22.222.222/0001-91',
      }),
    ]);

    await first.service.handleCallback(
      extractState(first.service.createAuthorizationUrl()),
      'code-a',
    );
    await second.service.handleCallback(
      extractState(second.service.createAuthorizationUrl('c1')),
      'code-b',
    );

    assert.deepEqual(
      database.accounts
        .map((account) => account.externalAccountId)
        .sort(),
      ['11111111000191', '22222222000191'],
    );
    assert.equal(database.authorizations.length, 2);
    assert.deepEqual(
      database.authorizations
        .map((authorization) => authorization.integrationKey)
        .sort(),
      ['c1', 'c2'],
    );
    const decrypted = database.authorizations
      .map((authorization) =>
        first.encryption.decrypt(authorization.accessTokenEncrypted),
      )
      .sort();
    assert.deepEqual(decrypted, ['access-account-a', 'access-account-b']);
  });

  it('rejects a crossed callback and preserves the existing C2 authorization', async () => {
    const database = new OlistOAuthDatabaseFake();
    const first = makeOAuthService(database, [
      jsonResponse(
        tokenResponse({
          access_token: 'access-c2-original',
          refresh_token: 'refresh-c2-original',
        }),
      ),
      jsonResponse({
        razaoSocial: 'Conta 2 Ltda',
        cpfCnpj: '44.444.444/0001-91',
      }),
    ]);
    await first.service.handleCallback(
      extractState(first.service.createAuthorizationUrl('c2')),
      'code-c2',
    );
    const originalCiphertext =
      database.authorizations[0]?.accessTokenEncrypted;

    const crossed = makeOAuthService(database, [
      jsonResponse(
        tokenResponse({
          access_token: 'crossed-access',
          refresh_token: 'crossed-refresh',
        }),
      ),
      jsonResponse({
        razaoSocial: 'Outra conta Ltda',
        cpfCnpj: '55.555.555/0001-91',
      }),
    ]);
    const crossedState = extractState(
      crossed.service.createAuthorizationUrl('c2'),
    );

    await assert.rejects(
      crossed.service.handleCallback(crossedState, 'crossed-code'),
      ConflictException,
    );
    assert.equal(database.accounts.length, 1);
    assert.equal(database.authorizations.length, 1);
    assert.equal(
      database.authorizations[0]?.accessTokenEncrypted,
      originalCiphertext,
    );
    assert.equal(
      first.encryption.decrypt(
        database.authorizations[0]!.accessTokenEncrypted,
      ),
      'access-c2-original',
    );
  });

  it('does not allow C1 to overwrite an account already authorized by C2', async () => {
    const database = new OlistOAuthDatabaseFake();
    const c2 = makeOAuthService(database, [
      jsonResponse(tokenResponse({ access_token: 'c2-access' })),
      jsonResponse({
        razaoSocial: 'Conta compartilhada Ltda',
        cpfCnpj: '66.666.666/0001-91',
      }),
    ]);
    await c2.service.handleCallback(
      extractState(c2.service.createAuthorizationUrl('c2')),
      'c2-code',
    );

    const c1 = makeOAuthService(database, [
      jsonResponse(tokenResponse({ access_token: 'c1-access' })),
      jsonResponse({
        razaoSocial: 'Conta compartilhada Ltda',
        cpfCnpj: '66.666.666/0001-91',
      }),
    ]);
    await assert.rejects(
      c1.service.handleCallback(
        extractState(c1.service.createAuthorizationUrl('c1')),
        'c1-code',
      ),
      ConflictException,
    );

    assert.equal(database.authorizations.length, 1);
    assert.equal(database.authorizations[0]?.integrationKey, 'c2');
    assert.equal(
      c2.encryption.decrypt(
        database.authorizations[0]!.accessTokenEncrypted,
      ),
      'c2-access',
    );
  });
});

interface FetchCall {
  url: URL;
  init: RequestInit;
}

interface StoredAuthorization {
  integrationKey: string;
  olistAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenType: string | null;
  scope: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
}

class OlistOAuthDatabaseFake {
  readonly accounts: OlistAccount[] = [];
  readonly authorizations: StoredAuthorization[] = [];

  readonly $transaction = async <T>(
    operation: (transaction: unknown) => Promise<T>,
  ): Promise<T> => operation(this.transactionClient());

  private transactionClient(): object {
    return {
      olistAccount: {
        findUnique: async (args: {
          where: { externalAccountId: string };
        }): Promise<
          (OlistAccount & { authorization: StoredAuthorization | null }) | null
        > => {
          const account = this.accounts.find(
            (candidate) =>
              candidate.externalAccountId === args.where.externalAccountId,
          );
          if (!account) {
            return null;
          }
          return {
            ...account,
            authorization:
              this.authorizations.find(
                (authorization) =>
                  authorization.olistAccountId === account.id,
              ) ?? null,
          };
        },
        upsert: async (args: {
          where: { externalAccountId: string };
          create: {
            externalAccountId: string;
            name: string;
            active: boolean;
          };
          update: { name: string; active: boolean };
        }): Promise<OlistAccount> => {
          const existing = this.accounts.find(
            (account) =>
              account.externalAccountId === args.where.externalAccountId,
          );
          if (existing) {
            existing.name = args.update.name;
            existing.active = args.update.active;
            return existing;
          }

          const account: OlistAccount = {
            id: `10000000-0000-4000-8000-${String(this.accounts.length + 1).padStart(12, '0')}`,
            ...args.create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.accounts.push(account);
          return account;
        },
      },
      olistAuthorization: {
        findUnique: async (args: {
          where: { integrationKey: string };
        }): Promise<
          | (StoredAuthorization & { olistAccount: OlistAccount })
          | null
        > => {
          const authorization = this.authorizations.find(
            (candidate) =>
              candidate.integrationKey === args.where.integrationKey,
          );
          if (!authorization) {
            return null;
          }
          const account = this.accounts.find(
            (candidate) => candidate.id === authorization.olistAccountId,
          );
          assert.ok(account);
          return { ...authorization, olistAccount: account };
        },
        create: async (args: {
          data: StoredAuthorization;
        }): Promise<StoredAuthorization> => {
          this.authorizations.push(args.data);
          return args.data;
        },
        update: async (args: {
          where: { integrationKey: string };
          data: Omit<StoredAuthorization, 'integrationKey' | 'olistAccountId'>;
        }): Promise<StoredAuthorization> => {
          const existingIndex = this.authorizations.findIndex(
            (authorization) =>
              authorization.integrationKey === args.where.integrationKey,
          );
          assert.ok(existingIndex >= 0);
          const authorization = {
            ...this.authorizations[existingIndex]!,
            ...args.data,
          };
          this.authorizations[existingIndex] = authorization;
          return authorization;
        },
      },
    };
  }
}

function makeOAuthService(
  database: OlistOAuthDatabaseFake,
  responses: Response[],
): {
  service: OlistOAuthService;
  oauthClient: OlistOAuthClient;
  encryption: TokenEncryptionService;
  calls: FetchCall[];
} {
  const { oauthClient, calls, config } = makeOAuthClient(responses);
  const encryption = new TokenEncryptionService(config);
  const integrationConfig = new OlistIntegrationConfigService(
    config as unknown as ConfigService<Record<string, unknown>, false>,
  );
  return {
    service: new OlistOAuthService(
      new OAuthStateStore(),
      integrationConfig,
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
  oauthClient: OlistOAuthClient;
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
    oauthClient: new OlistOAuthClient(fetchMock, 1_000),
    calls,
    config,
  };
}

function makeConfig(): ConfigService<EnvironmentVariables, true> {
  const values: Record<string, string> = {
    ...integrationConfigValues(),
    OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  };
  return makeConfigService(values) as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
}

function integrationConfigValues(): Record<string, string> {
  return {
    OLIST_INTEGRATION_KEYS: 'c1,c2',
    OLIST_DEFAULT_INTEGRATION_KEY: 'c2',
    OLIST_C2_CLIENT_ID: CLIENT_ID,
    OLIST_C2_CLIENT_SECRET: CLIENT_SECRET,
    OLIST_C2_REDIRECT_URI: REDIRECT_URI,
    OLIST_C1_CLIENT_ID: C1_CLIENT_ID,
    OLIST_C1_CLIENT_SECRET: C1_CLIENT_SECRET,
    OLIST_C1_REDIRECT_URI: C1_REDIRECT_URI,
  };
}

function makeIntegrationConfig(
  values: Record<string, string>,
): OlistIntegrationConfigService {
  return new OlistIntegrationConfigService(makeConfigService(values));
}

function makeConfigService(
  values: Record<string, string>,
): ConfigService<Record<string, unknown>, false> {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) {
        throw new Error(`Missing test config: ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService<Record<string, unknown>, false>;
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
    expires_in: 14_400,
    refresh_expires_in: 86_400,
    token_type: 'Bearer',
    scope: 'openid',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
