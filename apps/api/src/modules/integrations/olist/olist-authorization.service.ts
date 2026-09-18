import { Injectable } from '@nestjs/common';
import { OlistAccount, Prisma } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import { TokenEncryptionService } from '../oauth/token-encryption.service.js';
import { OlistOAuthClient } from './olist-oauth.client.js';

const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TRANSACTION_TIMEOUT_MS = 20_000;

export class OlistAuthorizationNotFoundError extends Error {
  constructor() {
    super('Olist authorization was not found.');
    this.name = 'OlistAuthorizationNotFoundError';
  }
}

export class OlistReauthorizationRequiredError extends Error {
  constructor() {
    super('Olist authorization must be renewed.');
    this.name = 'OlistReauthorizationRequiredError';
  }
}

@Injectable()
export class OlistAuthorizationService {
  private readonly refreshesInFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly encryption: TokenEncryptionService,
    private readonly oauthClient: OlistOAuthClient,
  ) {}

  async getAccessToken(
    olistAccount: Pick<OlistAccount, 'id'>,
  ): Promise<string> {
    const existingRefresh = this.refreshesInFlight.get(olistAccount.id);
    if (existingRefresh) {
      return existingRefresh;
    }

    const accessToken = this.loadOrRefresh(olistAccount.id);
    this.refreshesInFlight.set(olistAccount.id, accessToken);

    try {
      return await accessToken;
    } finally {
      if (this.refreshesInFlight.get(olistAccount.id) === accessToken) {
        this.refreshesInFlight.delete(olistAccount.id);
      }
    }
  }

  private loadOrRefresh(olistAccountId: string): Promise<string> {
    return this.database.$transaction(
      async (transaction) => {
        // Serialize refresh-token rotation per Olist account across all API
        // processes sharing PostgreSQL.
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${olistAccountId}))`,
        );

        const authorization = await transaction.olistAuthorization.findUnique({
          where: { olistAccountId },
        });
        if (!authorization) {
          throw new OlistAuthorizationNotFoundError();
        }

        const now = Date.now();
        if (authorization.expiresAt.getTime() > now + EXPIRY_SKEW_MS) {
          return this.encryption.decrypt(
            authorization.accessTokenEncrypted,
          );
        }

        if (
          authorization.refreshExpiresAt !== null &&
          authorization.refreshExpiresAt.getTime() <= now + EXPIRY_SKEW_MS
        ) {
          throw new OlistReauthorizationRequiredError();
        }

        const refreshToken = this.encryption.decrypt(
          authorization.refreshTokenEncrypted,
        );
        const refreshed = await this.oauthClient.refreshAccessToken(
          refreshToken,
        );
        const refreshedAt = Date.now();
        const expiresAt = new Date(
          refreshedAt + refreshed.expiresIn * 1_000,
        );
        const refreshExpiresAt =
          refreshed.refreshExpiresIn === null
            ? null
            : new Date(
                refreshedAt + refreshed.refreshExpiresIn * 1_000,
              );

        await transaction.olistAuthorization.update({
          where: { olistAccountId },
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
            refreshExpiresAt,
          },
        });

        return refreshed.accessToken;
      },
      { timeout: REFRESH_TRANSACTION_TIMEOUT_MS },
    );
  }
}
