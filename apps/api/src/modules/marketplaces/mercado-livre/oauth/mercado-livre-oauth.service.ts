import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Marketplace } from '@prisma/client';

import { DatabaseService } from '../../../../database/database.service.js';
import { MercadoLivreOAuthClient } from './mercado-livre-oauth.client.js';
import { MercadoLivreOAuthError } from './mercado-livre-oauth.types.js';
import {
  InvalidOAuthStateError,
  OAuthStateStore,
} from './oauth-state.store.js';
import { TokenEncryptionService } from './token-encryption.service.js';

export interface ConnectedMarketplaceAccount {
  connected: true;
  marketplaceAccount: {
    id: string;
    externalAccountId: string;
    name: string;
  };
}

@Injectable()
export class MercadoLivreOAuthService {
  constructor(
    private readonly stateStore: OAuthStateStore,
    private readonly oauthClient: MercadoLivreOAuthClient,
    private readonly encryption: TokenEncryptionService,
    private readonly database: DatabaseService,
  ) {}

  createAuthorizationUrl(): string {
    const authorization = this.stateStore.create();
    return this.oauthClient.createAuthorizationUrl(
      authorization.state,
      authorization.codeChallenge,
    );
  }

  async handleCallback(
    state: string | undefined,
    code: string | undefined,
    authorizationError?: string,
  ): Promise<ConnectedMarketplaceAccount> {
    if (typeof state !== 'string' || state.length === 0) {
      throw new BadRequestException('OAuth state is required.');
    }

    let codeVerifier: string;
    try {
      codeVerifier = this.stateStore.consume(state);
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
        'Mercado Livre authorization was not completed.',
      );
    }

    try {
      const tokens = await this.oauthClient.exchangeAuthorizationCode(
        code,
        codeVerifier,
      );
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1_000);
      const user = await this.oauthClient.getCurrentUser(tokens.accessToken);

      const account = await this.database.$transaction(async (transaction) => {
        const marketplaceAccount = await transaction.marketplaceAccount.upsert({
          where: {
            marketplace_externalAccountId: {
              marketplace: Marketplace.MERCADO_LIVRE,
              externalAccountId: user.id,
            },
          },
          create: {
            marketplace: Marketplace.MERCADO_LIVRE,
            externalAccountId: user.id,
            name: user.name,
            active: true,
          },
          update: {
            name: user.name,
            active: true,
          },
        });

        await transaction.marketplaceAuthorization.upsert({
          where: { marketplaceAccountId: marketplaceAccount.id },
          create: {
            marketplaceAccountId: marketplaceAccount.id,
            accessTokenEncrypted: this.encryption.encrypt(
              tokens.accessToken,
            ),
            refreshTokenEncrypted: this.encryption.encrypt(
              tokens.refreshToken,
            ),
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            expiresAt,
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
          },
        });

        return marketplaceAccount;
      });

      return {
        connected: true,
        marketplaceAccount: {
          id: account.id,
          externalAccountId: account.externalAccountId,
          name: account.name,
        },
      };
    } catch (error: unknown) {
      if (error instanceof MercadoLivreOAuthError) {
        throw new BadGatewayException({
          statusCode: 502,
          error: 'Bad Gateway',
          message:
            error.code === 'INVALID_GRANT'
              ? 'Mercado Livre authorization code is invalid or expired.'
              : 'Mercado Livre authorization could not be completed.',
        });
      }
      throw error;
    }
  }
}
