import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../../../../config/environment.validation.js';
import {
  MercadoLivreOAuthError,
  MercadoLivreTokenResponse,
  MercadoLivreUser,
} from './mercado-livre-oauth.types.js';

const AUTHORIZATION_URL =
  'https://auth.mercadolivre.com.br/authorization';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const CURRENT_USER_URL = 'https://api.mercadolibre.com/users/me';

export const MERCADO_LIVRE_OAUTH_FETCH = Symbol(
  'MERCADO_LIVRE_OAUTH_FETCH',
);
export const MERCADO_LIVRE_OAUTH_TIMEOUT_MS = Symbol(
  'MERCADO_LIVRE_OAUTH_TIMEOUT_MS',
);

@Injectable()
export class MercadoLivreOAuthClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(MERCADO_LIVRE_OAUTH_FETCH)
    private readonly fetchImplementation: typeof fetch,
    @Inject(MERCADO_LIVRE_OAUTH_TIMEOUT_MS)
    private readonly timeoutMs: number,
  ) {}

  createAuthorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<MercadoLivreTokenResponse> {
    return this.requestToken({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  refreshAccessToken(refreshToken: string): Promise<MercadoLivreTokenResponse> {
    return this.requestToken({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });
  }

  async getCurrentUser(accessToken: string): Promise<MercadoLivreUser> {
    const response = await this.request(CURRENT_USER_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new MercadoLivreOAuthError(
        'REQUEST_FAILED',
        'Mercado Livre rejected the user request.',
      );
    }

    const body = await readJson(response);
    if (!isRecord(body) || !isExternalId(body.id)) {
      throw new MercadoLivreOAuthError(
        'INVALID_RESPONSE',
        'Mercado Livre returned an unexpected user response.',
      );
    }

    const id = String(body.id);
    const name =
      firstNonEmptyString(body.nickname, body.name, body.first_name) ?? id;

    return { id, name };
  }

  private async requestToken(
    fields: Record<string, string>,
  ): Promise<MercadoLivreTokenResponse> {
    const response = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
    });
    const body = await readJson(response);

    if (!response.ok) {
      const errorCode =
        isRecord(body) && body.error === 'invalid_grant'
          ? 'INVALID_GRANT'
          : 'REQUEST_FAILED';
      throw new MercadoLivreOAuthError(
        errorCode,
        errorCode === 'INVALID_GRANT'
          ? 'Mercado Livre authorization grant is invalid or expired.'
          : 'Mercado Livre rejected the token request.',
      );
    }

    if (!isTokenResponse(body)) {
      throw new MercadoLivreOAuthError(
        'INVALID_RESPONSE',
        'Mercado Livre returned an unexpected token response.',
      );
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      tokenType:
        typeof body.token_type === 'string' ? body.token_type : null,
      scope: typeof body.scope === 'string' ? body.scope : null,
      expiresIn: body.expires_in,
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      return await this.fetchImplementation(url, {
        ...init,
        signal: abortController.signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new MercadoLivreOAuthError(
          'TIMEOUT',
          'Mercado Livre request timed out.',
        );
      }

      throw new MercadoLivreOAuthError(
        'REQUEST_FAILED',
        'Mercado Livre request failed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private get clientId(): string {
    return this.config.getOrThrow('MELI_CLIENT_ID');
  }

  private get clientSecret(): string {
    return this.config.getOrThrow('MELI_CLIENT_SECRET');
  }

  private get redirectUri(): string {
    return this.config.getOrThrow('MELI_REDIRECT_URI');
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MercadoLivreOAuthError(
      'INVALID_RESPONSE',
      'Mercado Livre returned an invalid JSON response.',
    );
  }
}

function isTokenResponse(value: unknown): value is {
  access_token: string;
  refresh_token: string;
  expires_in: number;
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

function isExternalId(value: unknown): value is string | number {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
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
