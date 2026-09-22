import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1_000;

export type OAuthProvider = 'mercado-livre' | 'olist';

interface PendingAuthorization {
  provider: OAuthProvider;
  integrationKey: string | null;
  codeVerifier: string;
  expiresAt: number;
  expirationTimer: ReturnType<typeof setTimeout>;
}

export interface OAuthAuthorizationRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  expiresAt: Date;
}

export interface ConsumedOAuthAuthorization {
  codeVerifier: string;
  integrationKey: string;
}

export class InvalidOAuthStateError extends Error {
  constructor() {
    super('OAuth state is invalid or expired.');
    this.name = 'InvalidOAuthStateError';
  }
}

@Injectable()
export class OAuthStateStore {
  private readonly pending = new Map<string, PendingAuthorization>();

  create(
    provider: OAuthProvider,
    now = Date.now(),
  ): OAuthAuthorizationRequest {
    return this.createPending(provider, null, now);
  }

  createBound(
    provider: OAuthProvider,
    integrationKey: string,
    now = Date.now(),
  ): OAuthAuthorizationRequest {
    return this.createPending(provider, integrationKey, now);
  }

  private createPending(
    provider: OAuthProvider,
    integrationKey: string | null,
    now: number,
  ): OAuthAuthorizationRequest {
    this.removeExpired(now);

    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64url');
    const expiresAt = now + STATE_TTL_MS;

    const expirationTimer = setTimeout(() => {
      const current = this.pending.get(state);
      if (current?.expiresAt === expiresAt) {
        this.pending.delete(state);
      }
    }, STATE_TTL_MS);
    expirationTimer.unref();

    this.pending.set(state, {
      provider,
      integrationKey,
      codeVerifier,
      expiresAt,
      expirationTimer,
    });

    return {
      state,
      codeVerifier,
      codeChallenge,
      expiresAt: new Date(expiresAt),
    };
  }

  consume(
    state: string,
    provider: OAuthProvider,
    now = Date.now(),
  ): string {
    return this.consumePending(state, provider, now).codeVerifier;
  }

  consumeBound(
    state: string,
    provider: OAuthProvider,
    now = Date.now(),
  ): ConsumedOAuthAuthorization {
    const authorization = this.consumePending(state, provider, now);
    if (authorization.integrationKey === null) {
      throw new InvalidOAuthStateError();
    }

    return {
      codeVerifier: authorization.codeVerifier,
      integrationKey: authorization.integrationKey,
    };
  }

  private consumePending(
    state: string,
    provider: OAuthProvider,
    now: number,
  ): PendingAuthorization {
    const authorization = this.pending.get(state);

    // Delete first so every lookup, including an expired or mismatched one,
    // is single-use.
    this.pending.delete(state);
    if (authorization) {
      clearTimeout(authorization.expirationTimer);
    }

    if (
      !authorization ||
      authorization.provider !== provider ||
      authorization.expiresAt <= now
    ) {
      throw new InvalidOAuthStateError();
    }

    return authorization;
  }

  private removeExpired(now: number): void {
    for (const [state, authorization] of this.pending) {
      if (authorization.expiresAt <= now) {
        clearTimeout(authorization.expirationTimer);
        this.pending.delete(state);
      }
    }
  }
}
