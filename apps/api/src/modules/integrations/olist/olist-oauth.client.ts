import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../config/environment.validation.js';
import {
  OlistAccountIdentity,
  OlistOAuthError,
  OlistOAuthExternalStage,
  OlistTokenResponse,
} from './olist-oauth.types.js';

const AUTHORIZATION_URL =
  'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth';
const TOKEN_URL =
  'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';
const ACCOUNT_INFO_URL = 'https://api.tiny.com.br/public-api/v3/info';

export const OLIST_OAUTH_FETCH = Symbol('OLIST_OAUTH_FETCH');
export const OLIST_OAUTH_TIMEOUT_MS = Symbol('OLIST_OAUTH_TIMEOUT_MS');

@Injectable()
export class OlistOAuthClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(OLIST_OAUTH_FETCH)
    private readonly fetchImplementation: typeof fetch,
    @Inject(OLIST_OAUTH_TIMEOUT_MS)
    private readonly timeoutMs: number,
  ) {}

  createAuthorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<OlistTokenResponse> {
    return this.requestToken(
      {
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        code,
        code_verifier: codeVerifier,
      },
      'token_exchange',
    );
  }

  refreshAccessToken(refreshToken: string): Promise<OlistTokenResponse> {
    return this.requestToken(
      {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      },
      'token_refresh',
    );
  }

  async getAccountInfo(accessToken: string): Promise<OlistAccountIdentity> {
    const response = await this.request(
      ACCOUNT_INFO_URL,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'account_info',
    );

    if (!response.ok) {
      throw new OlistOAuthError(
        'REQUEST_FAILED',
        'Olist rejected the account information request.',
        'account_info',
        response.status,
      );
    }

    const body = await readJson(response, 'account_info');
    if (!isRecord(body) || typeof body.cpfCnpj !== 'string') {
      throw new OlistOAuthError(
        'INVALID_RESPONSE',
        'Olist returned an unexpected account information response.',
        'account_info',
        response.status,
      );
    }

    const externalAccountId = body.cpfCnpj.replace(/\D/g, '');
    if (externalAccountId.length !== 11 && externalAccountId.length !== 14) {
      throw new OlistOAuthError(
        'INVALID_RESPONSE',
        'Olist returned an invalid account identifier.',
        'account_info',
        response.status,
      );
    }

    const name =
      firstNonEmptyString(body.fantasia, body.razaoSocial) ??
      externalAccountId;

    return { externalAccountId, name };
  }

  private async requestToken(
    fields: Record<string, string>,
    stage: Extract<
      OlistOAuthExternalStage,
      'token_exchange' | 'token_refresh'
    >,
  ): Promise<OlistTokenResponse> {
    const response = await this.request(
      TOKEN_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      },
      stage,
    );
    const body = await readJson(response, stage);

    if (!response.ok) {
      const errorCode =
        isRecord(body) && body.error === 'invalid_grant'
          ? 'INVALID_GRANT'
          : 'REQUEST_FAILED';
      throw new OlistOAuthError(
        errorCode,
        errorCode === 'INVALID_GRANT'
          ? 'Olist authorization grant is invalid or expired.'
          : 'Olist rejected the token request.',
        stage,
        response.status,
      );
    }

    if (!isTokenResponse(body)) {
      throw new OlistOAuthError(
        'INVALID_RESPONSE',
        'Olist returned an unexpected token response.',
        stage,
        response.status,
      );
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      tokenType:
        typeof body.token_type === 'string' ? body.token_type : null,
      scope: typeof body.scope === 'string' ? body.scope : null,
      expiresIn: body.expires_in,
      refreshExpiresIn:
        typeof body.refresh_expires_in === 'number' &&
        Number.isSafeInteger(body.refresh_expires_in) &&
        body.refresh_expires_in > 0
          ? body.refresh_expires_in
          : null,
    };
  }

  private async request(
    url: string,
    init: RequestInit,
    stage: OlistOAuthExternalStage,
  ): Promise<Response> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      return await this.fetchImplementation(url, {
        ...init,
        signal: abortController.signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new OlistOAuthError(
          'TIMEOUT',
          'Olist request timed out.',
          stage,
          null,
        );
      }

      throw new OlistOAuthError(
        'REQUEST_FAILED',
        'Olist request failed.',
        stage,
        null,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private get clientId(): string {
    return this.config.getOrThrow('OLIST_CLIENT_ID');
  }

  private get clientSecret(): string {
    return this.config.getOrThrow('OLIST_CLIENT_SECRET');
  }

  private get redirectUri(): string {
    return this.config.getOrThrow('OLIST_REDIRECT_URI');
  }
}

async function readJson(
  response: Response,
  stage: OlistOAuthExternalStage,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OlistOAuthError(
      'INVALID_RESPONSE',
      'Olist returned an invalid JSON response.',
      stage,
      response.status,
    );
  }
}

function isTokenResponse(value: unknown): value is {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
} {
  return (
    isRecord(value) &&
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.refresh_token === 'string' &&
    value.refresh_token.length > 0 &&
    typeof value.expires_in === 'number' &&
    Number.isSafeInteger(value.expires_in) &&
    value.expires_in > 0
  );
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === 'string' && value.trim().length > 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
