import { Injectable } from '@nestjs/common';
import { MarketplaceAccount, Prisma } from '@prisma/client';

import { DatabaseService } from '../../../../database/database.service.js';
import { MercadoLivreAccessTokenProvider } from '../mercado-livre.client.js';
import { MercadoLivreOAuthClient } from './mercado-livre-oauth.client.js';
import { TokenEncryptionService } from './token-encryption.service.js';

const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TRANSACTION_TIMEOUT_MS = 20_000;

export class MarketplaceAuthorizationNotFoundError extends Error {
  constructor() {
    super('Marketplace authorization was not found.');
    this.name = 'MarketplaceAuthorizationNotFoundError';
  }
}

@Injectable()
export class MarketplaceAuthorizationService
  implements MercadoLivreAccessTokenProvider
{
  private readonly refreshesInFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly encryption: TokenEncryptionService,
    private readonly oauthClient: MercadoLivreOAuthClient,
  ) {}

  async getAccessToken(
    marketplaceAccount: Pick<MarketplaceAccount, 'id'>,
  ): Promise<string> {
    const existingRefresh = this.refreshesInFlight.get(marketplaceAccount.id);
    if (existingRefresh) {
      return existingRefresh;
    }

    const accessToken = this.loadOrRefresh(marketplaceAccount.id);
    this.refreshesInFlight.set(marketplaceAccount.id, accessToken);

    try {
      return await accessToken;
    } finally {
      if (this.refreshesInFlight.get(marketplaceAccount.id) === accessToken) {
        this.refreshesInFlight.delete(marketplaceAccount.id);
      }
    }
  }

  private loadOrRefresh(marketplaceAccountId: string): Promise<string> {
    return this.database.$transaction(
      async (transaction) => {
        // A transaction-scoped advisory lock serializes refresh-token rotation
        // for this account across every API process sharing PostgreSQL.
        await transaction.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${marketplaceAccountId}))`,
        );

        const authorization =
          await transaction.marketplaceAuthorization.findUnique({
            where: { marketplaceAccountId },
          });

        if (!authorization) {
          throw new MarketplaceAuthorizationNotFoundError();
        }

        if (
          authorization.expiresAt.getTime() >
          Date.now() + EXPIRY_SKEW_MS
        ) {
          return this.encryption.decrypt(
            authorization.accessTokenEncrypted,
          );
        }

        const refreshToken = this.encryption.decrypt(
          authorization.refreshTokenEncrypted,
        );
        const refreshed = await this.oauthClient.refreshAccessToken(
          refreshToken,
        );
        const expiresAt = new Date(
          Date.now() + refreshed.expiresIn * 1_000,
        );

        await transaction.marketplaceAuthorization.update({
          where: { marketplaceAccountId },
          data: {
            accessTokenEncrypted: this.encryption.encrypt(
              refreshed.accessToken,
            ),
            refreshTokenEncrypted: this.encryption.encrypt(
              refreshed.refreshToken,
            ),
            tokenType: refreshed.tokenType,
            scope: refreshed.scope,
            expiresAt,
          },
        });

        return refreshed.accessToken;
      },
      { timeout: REFRESH_TRANSACTION_TIMEOUT_MS },
    );
  }
}
