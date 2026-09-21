import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { DatabaseService } from '../../../database/database.service.js';
import {
  InvalidOAuthStateError,
  OAuthStateStore,
} from '../oauth/oauth-state.store.js';
import { TokenEncryptionService } from '../oauth/token-encryption.service.js';
import { OlistOAuthClient } from './olist-oauth.client.js';
import { OlistOAuthError } from './olist-oauth.types.js';

export interface ConnectedOlistAccount {
  connected: true;
  olistAccount: {
    id: string;
    name: string;
  };
}

@Injectable()
export class OlistOAuthService {
  private readonly logger = new Logger(OlistOAuthService.name);

  constructor(
    private readonly stateStore: OAuthStateStore,
    private readonly oauthClient: OlistOAuthClient,
    private readonly encryption: TokenEncryptionService,
    private readonly database: DatabaseService,
  ) {}

  createAuthorizationUrl(): string {
    const authorization = this.stateStore.create('olist');
    return this.oauthClient.createAuthorizationUrl(
      authorization.state,
      authorization.codeChallenge,
    );
  }

  async handleCallback(
    state: string | undefined,
    code: string | undefined,
    authorizationError?: string,
  ): Promise<ConnectedOlistAccount> {
    if (typeof state !== 'string' || state.length === 0) {
      this.logFailure(
        'state_validation',
        null,
        'OAuth state is required.',
        'missing_state',
      );
      throw new BadRequestException('OAuth state is required.');
    }

    let codeVerifier: string;
    try {
      codeVerifier = this.stateStore.consume(state, 'olist');
    } catch (error: unknown) {
      if (error instanceof InvalidOAuthStateError) {
        this.logFailure(
          'state_validation',
          null,
          'OAuth state is invalid or expired.',
          'invalid_or_expired_state',
        );
        throw new BadRequestException('OAuth state is invalid or expired.');
      }
      throw error;
    }

    if (
      authorizationError !== undefined ||
      typeof code !== 'string' ||
      code.length === 0
    ) {
      this.logFailure(
        'authorization_callback',
        null,
        'Olist authorization was not completed.',
        authorizationError === undefined
          ? 'missing_authorization_code'
          : 'provider_authorization_error',
      );
      throw new BadRequestException(
        'Olist authorization was not completed.',
      );
    }

    let tokens: Awaited<
      ReturnType<OlistOAuthClient['exchangeAuthorizationCode']>
    >;
    try {
      tokens = await this.oauthClient.exchangeAuthorizationCode(
        code,
        codeVerifier,
      );
    } catch (error: unknown) {
      throw this.handleExternalError(error, 'token_exchange');
    }

    let identity: Awaited<ReturnType<OlistOAuthClient['getAccountInfo']>>;
    try {
      identity = await this.oauthClient.getAccountInfo(
        tokens.accessToken,
      );
    } catch (error: unknown) {
      throw this.handleExternalError(error, 'account_info');
    }

    const now = Date.now();
    const expiresAt = new Date(now + tokens.expiresIn * 1_000);
    const refreshExpiresAt =
      tokens.refreshExpiresIn === null
        ? null
        : new Date(now + tokens.refreshExpiresIn * 1_000);

    let accessTokenEncrypted: string;
    let refreshTokenEncrypted: string;
    try {
      accessTokenEncrypted = this.encryption.encrypt(tokens.accessToken);
      refreshTokenEncrypted = this.encryption.encrypt(tokens.refreshToken);
    } catch (error: unknown) {
      this.logFailure(
        'encryption',
        null,
        'Olist credentials could not be encrypted.',
        errorName(error),
      );
      throw error;
    }

    let account: { id: string; name: string };
    try {
      account = await this.database.$transaction(async (transaction) => {
        const olistAccount = await transaction.olistAccount.upsert({
          where: { externalAccountId: identity.externalAccountId },
          create: {
            externalAccountId: identity.externalAccountId,
            name: identity.name,
            active: true,
          },
          update: {
            name: identity.name,
            active: true,
          },
        });

        await transaction.olistAuthorization.upsert({
          where: { olistAccountId: olistAccount.id },
          create: {
            olistAccountId: olistAccount.id,
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            expiresAt,
            refreshExpiresAt,
          },
          update: {
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            expiresAt,
            refreshExpiresAt,
          },
        });

        return olistAccount;
      });
    } catch (error: unknown) {
      this.logFailure(
        'persistence',
        null,
        'Olist authorization could not be persisted.',
        errorName(error),
      );
      throw error;
    }

    this.logger.log(
      JSON.stringify({
        event: 'olist_oauth_completed',
        stage: 'persistence',
        externalStatus: null,
        message: 'Olist authorization completed.',
      }),
    );

    return {
      connected: true,
      olistAccount: {
        id: account.id,
        name: account.name,
      },
    };
  }

  private handleExternalError(
    error: unknown,
    expectedStage: 'token_exchange' | 'account_info',
  ): Error {
    if (!(error instanceof OlistOAuthError)) {
      this.logFailure(
        expectedStage,
        null,
        'Olist authorization failed unexpectedly.',
        errorName(error),
      );
      return error instanceof Error ? error : new Error('Unknown OAuth error.');
    }

    const message =
      error.code === 'INVALID_GRANT'
        ? 'Olist authorization code is invalid or expired.'
        : error.message;
    this.logFailure(
      error.stage,
      error.externalStatus,
      message,
      error.code.toLowerCase(),
    );

    return new BadGatewayException({
      statusCode: 502,
      error: 'Bad Gateway',
      stage: error.stage,
      externalStatus: error.externalStatus,
      cause: error.code.toLowerCase(),
      message:
        error.code === 'INVALID_GRANT'
          ? 'Olist authorization code is invalid or expired.'
          : 'Olist authorization could not be completed.',
    });
  }

  private logFailure(
    stage: string,
    externalStatus: number | null,
    message: string,
    cause: string,
  ): void {
    this.logger.error(
      JSON.stringify({
        event: 'olist_oauth_failed',
        stage,
        externalStatus,
        message,
        cause,
      }),
    );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
