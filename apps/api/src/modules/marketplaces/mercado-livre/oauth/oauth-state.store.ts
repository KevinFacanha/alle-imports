import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1_000;

interface PendingAuthorization {
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

export class InvalidOAuthStateError extends Error {
  constructor() {
    super('OAuth state is invalid or expired.');
    this.name = 'InvalidOAuthStateError';
  }
}

@Injectable()
export class OAuthStateStore {
  private readonly pending = new Map<string, PendingAuthorization>();

  create(now = Date.now()): OAuthAuthorizationRequest {
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

    this.pending.set(state, { codeVerifier, expiresAt, expirationTimer });

    return {
      state,
      codeVerifier,
      codeChallenge,
      expiresAt: new Date(expiresAt),
    };
  }

  consume(state: string, now = Date.now()): string {
    const authorization = this.pending.get(state);

    // Delete first so every lookup, including an expired one, is single-use.
    this.pending.delete(state);
    if (authorization) {
      clearTimeout(authorization.expirationTimer);
    }

    if (!authorization || authorization.expiresAt <= now) {
      throw new InvalidOAuthStateError();
    }

    return authorization.codeVerifier;
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
