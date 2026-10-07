import { Injectable, Logger } from '@nestjs/common';
import { OlistAccount, Prisma } from '@prisma/client';

import { DatabaseService } from '../../../database/database.service.js';
import { TokenEncryptionService } from '../oauth/token-encryption.service.js';
import { OlistIntegrationConfigService } from './olist-integration-config.service.js';
import { OlistOAuthClient } from './olist-oauth.client.js';
import { OlistOAuthError } from './olist-oauth.types.js';

export const OLIST_ACCESS_REFRESH_MARGIN_MS = 10 * 60_000;
export const OLIST_REFRESH_REFRESH_MARGIN_MS = 2 * 60 * 60_000;
const REFRESH_TRANSACTION_TIMEOUT_MS = 20_000;

export type OlistTokenKeeperOutcome =
  | 'SKIPPED'
  | 'REFRESHED'
  | 'RETRY'
  | 'REAUTH_REQUIRED';

export interface OlistTokenRefreshResult {
  integrationKey: string;
  outcome: OlistTokenKeeperOutcome;
  accessRemainingMinutes: number;
  refreshRemainingMinutes: number | null;
  error?: string;
}

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

export class OlistTokenRefreshFailedError extends Error {
  constructor() {
    super('Olist access token could not be refreshed.');
    this.name = 'OlistTokenRefreshFailedError';
  }
}

@Injectable()
export class OlistAuthorizationService {
  private readonly logger = new Logger(OlistAuthorizationService.name);
  private readonly refreshesInFlight = new Map<
    string,
    Promise<OlistTokenRefreshResult>
  >();

  constructor(
    private readonly database: DatabaseService,
    private readonly encryption: TokenEncryptionService,
    private readonly integrationConfig: OlistIntegrationConfigService,
    private readonly oauthClient: OlistOAuthClient,
  ) {}

  async getAccessToken(
    olistAccount: Pick<OlistAccount, 'id'>,
  ): Promise<string> {
    const refresh = await this.refreshIfDue(olistAccount.id);
    if (refresh.outcome === 'REAUTH_REQUIRED') {
      throw new OlistReauthorizationRequiredError();
    }

    const authorization = await this.database.olistAuthorization.findUnique({
      where: { olistAccountId: olistAccount.id },
    });
    if (!authorization) {
      throw new OlistAuthorizationNotFoundError();
    }
    if (authorization.status === 'REAUTH_REQUIRED') {
      throw new OlistReauthorizationRequiredError();
    }
    if (authorization.expiresAt.getTime() <= Date.now()) {
      throw new OlistTokenRefreshFailedError();
    }

    return this.encryption.decrypt(authorization.accessTokenEncrypted);
  }

  async refreshIfDue(
    olistAccountId: string,
  ): Promise<OlistTokenRefreshResult> {
    const existingRefresh = this.refreshesInFlight.get(olistAccountId);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refresh = this.refreshUnderAccountLock(olistAccountId);
    this.refreshesInFlight.set(olistAccountId, refresh);

    try {
      const result = await refresh;
      this.logResult(result);
      return result;
    } finally {
      if (this.refreshesInFlight.get(olistAccountId) === refresh) {
        this.refreshesInFlight.delete(olistAccountId);
      }
    }
  }

  private refreshUnderAccountLock(
    olistAccountId: string,
  ): Promise<OlistTokenRefreshResult> {
    return this.database.$transaction(
      async (transaction) => {
        // Every attempt reacquires the account lock and rereads current state.
        // This serializes refresh-token rotation across API processes.
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${olistAccountId}))`,
        );

        const authorization = await transaction.olistAuthorization.findUnique({
          where: { olistAccountId },
        });
        if (!authorization) {
          throw new OlistAuthorizationNotFoundError();
        }

        const checkedAt = new Date();
        const accessRemainingMs =
          authorization.expiresAt.getTime() - checkedAt.getTime();
        const refreshRemainingMs =
          authorization.refreshExpiresAt === null
            ? null
            : authorization.refreshExpiresAt.getTime() - checkedAt.getTime();
        const resultBase = {
          integrationKey: authorization.integrationKey,
          accessRemainingMinutes: roundedMinutes(accessRemainingMs),
          refreshRemainingMinutes:
            refreshRemainingMs === null
              ? null
              : roundedMinutes(refreshRemainingMs),
        };

        if (authorization.status === 'REAUTH_REQUIRED') {
          return { ...resultBase, outcome: 'REAUTH_REQUIRED' };
        }

        if (refreshRemainingMs !== null && refreshRemainingMs <= 0) {
          await transaction.olistAuthorization.update({
            where: { olistAccountId },
            data: {
              status: 'REAUTH_REQUIRED',
              statusReason: 'refresh_token_expired',
            },
          });
          return {
            ...resultBase,
            outcome: 'REAUTH_REQUIRED',
            error: 'refresh_token_expired',
          };
        }

        const accessRefreshDue =
          accessRemainingMs <= OLIST_ACCESS_REFRESH_MARGIN_MS;
        const preventiveRefreshDue =
          refreshRemainingMs !== null &&
          refreshRemainingMs <= OLIST_REFRESH_REFRESH_MARGIN_MS;
        if (!accessRefreshDue && !preventiveRefreshDue) {
          return { ...resultBase, outcome: 'SKIPPED' };
        }

        await transaction.olistAuthorization.update({
          where: { olistAccountId },
          data: { lastRefreshAttemptAt: checkedAt },
        });

        try {
          const refreshToken = this.encryption.decrypt(
            authorization.refreshTokenEncrypted,
          );
          const credentials = this.integrationConfig.resolve(
            authorization.integrationKey,
          );
          const refreshed = await this.oauthClient.refreshAccessToken(
            credentials,
            refreshToken,
          );
          const refreshedAt = new Date();
          const expiresAt = new Date(
            refreshedAt.getTime() + refreshed.expiresIn * 1_000,
          );
          const refreshExpiresAt =
            refreshed.refreshExpiresIn === null
              ? null
              : new Date(
                  refreshedAt.getTime() +
                    refreshed.refreshExpiresIn * 1_000,
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
              status: 'ACTIVE',
              statusReason: null,
              lastRefreshSuccessAt: refreshedAt,
            },
          });

          return {
            integrationKey: authorization.integrationKey,
            outcome: 'REFRESHED',
            accessRemainingMinutes: roundedMinutes(
              expiresAt.getTime() - refreshedAt.getTime(),
            ),
            refreshRemainingMinutes:
              refreshExpiresAt === null
                ? null
                : roundedMinutes(
                    refreshExpiresAt.getTime() - refreshedAt.getTime(),
                  ),
          };
        } catch (error: unknown) {
          if (isInvalidGrant(error)) {
            await transaction.olistAuthorization.update({
              where: { olistAccountId },
              data: {
                status: 'REAUTH_REQUIRED',
                statusReason: 'invalid_grant',
              },
            });
            return {
              ...resultBase,
              outcome: 'REAUTH_REQUIRED',
              error: 'invalid_grant',
            };
          }

          const retryError = retryableError(error);
          if (retryError !== null) {
            return {
              ...resultBase,
              outcome: 'RETRY',
              error: retryError,
            };
          }

          return {
            ...resultBase,
            outcome: 'SKIPPED',
            error: sanitizedError(error),
          };
        }
      },
      { timeout: REFRESH_TRANSACTION_TIMEOUT_MS },
    );
  }

  private logResult(result: OlistTokenRefreshResult): void {
    this.logger.log(
      JSON.stringify({
        integrationKey: result.integrationKey,
        result: result.outcome,
        accessRemainingMinutes: result.accessRemainingMinutes,
        refreshRemainingMinutes: result.refreshRemainingMinutes,
        ...(result.error === undefined ? {} : { error: result.error }),
      }),
    );
  }
}

function roundedMinutes(milliseconds: number): number {
  return Math.round(milliseconds / 60_000);
}

function isInvalidGrant(error: unknown): boolean {
  return error instanceof OlistOAuthError && error.code === 'INVALID_GRANT';
}

function retryableError(error: unknown): string | null {
  if (!(error instanceof OlistOAuthError)) {
    return null;
  }
  if (error.code === 'TIMEOUT') {
    return 'timeout';
  }
  if (error.code !== 'REQUEST_FAILED') {
    return null;
  }
  if (error.externalStatus === null) {
    return 'connection';
  }
  if (error.externalStatus === 429) {
    return 'http_429';
  }
  if (error.externalStatus >= 500 && error.externalStatus <= 599) {
    return 'http_5xx';
  }
  return null;
}

function sanitizedError(error: unknown): string {
  if (error instanceof OlistOAuthError) {
    return error.externalStatus === null
      ? error.code.toLowerCase()
      : `${error.code.toLowerCase()}_${error.externalStatus}`;
  }
  return error instanceof Error ? error.name : 'unknown_error';
}
