import {
  BadGatewayException,
  BadRequestException,
  Injectable,
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
      throw new BadRequestException('OAuth state is required.');
    }

    let codeVerifier: string;
    try {
      codeVerifier = this.stateStore.consume(state, 'olist');
    } catch (error: unknown) {
      if (error instanceof InvalidOAuthStateError) {
        throw new BadRequestException('OAuth state is invalid or expired.');
      }
      throw error;
    }

    if (
      authorizationError !== undefined ||
      typeof code !== 'string' ||
      code.length === 0
    ) {
      throw new BadRequestException(
        'Olist authorization was not completed.',
      );
    }

    try {
      const tokens = await this.oauthClient.exchangeAuthorizationCode(
        code,
        codeVerifier,
      );
      const now = Date.now();
      const expiresAt = new Date(now + tokens.expiresIn * 1_000);
      const refreshExpiresAt =
        tokens.refreshExpiresIn === null
          ? null
          : new Date(now + tokens.refreshExpiresIn * 1_000);
      const identity = await this.oauthClient.getAccountInfo(
        tokens.accessToken,
      );

      const account = await this.database.$transaction(async (transaction) => {
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
            accessTokenEncrypted: this.encryption.encrypt(
              tokens.accessToken,
            ),
            refreshTokenEncrypted: this.encryption.encrypt(
              tokens.refreshToken,
            ),
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            expiresAt,
            refreshExpiresAt,
          },
          update: {
            accessTokenEncrypted: this.encryption.encrypt(
              tokens.accessToken,
            ),
            refreshTokenEncrypted: this.encryption.encrypt(
              tokens.refreshToken,
            ),
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            expiresAt,
            refreshExpiresAt,
          },
        });

        return olistAccount;
      });

      return {
        connected: true,
        olistAccount: {
          id: account.id,
          name: account.name,
        },
      };
    } catch (error: unknown) {
      if (error instanceof OlistOAuthError) {
        throw new BadGatewayException({
          statusCode: 502,
          error: 'Bad Gateway',
          message:
            error.code === 'INVALID_GRANT'
              ? 'Olist authorization code is invalid or expired.'
              : 'Olist authorization could not be completed.',
        });
      }
      throw error;
    }
  }
}
