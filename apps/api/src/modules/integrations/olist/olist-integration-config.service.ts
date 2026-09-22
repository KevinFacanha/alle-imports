import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LEGACY_INTEGRATION_KEY = 'c2';
const INTEGRATION_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export interface OlistIntegrationCredentials {
  integrationKey: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class OlistIntegrationNotConfiguredError extends Error {
  constructor() {
    super('Olist integration is not configured.');
    this.name = 'OlistIntegrationNotConfiguredError';
  }
}

@Injectable()
export class OlistIntegrationConfigService {
  constructor(
    private readonly config: ConfigService<Record<string, unknown>, false>,
  ) {}

  resolve(requestedIntegrationKey?: string): OlistIntegrationCredentials {
    const integrationKey =
      requestedIntegrationKey ??
      this.optionalString('OLIST_DEFAULT_INTEGRATION_KEY') ??
      LEGACY_INTEGRATION_KEY;

    if (
      !INTEGRATION_KEY_PATTERN.test(integrationKey) ||
      !this.configuredKeys().has(integrationKey)
    ) {
      throw new OlistIntegrationNotConfiguredError();
    }

    const prefix = `OLIST_${integrationKey.toUpperCase().replaceAll('-', '_')}`;
    const clientId = this.scopedOrLegacy(
      `${prefix}_CLIENT_ID`,
      'OLIST_CLIENT_ID',
      integrationKey,
    );
    const clientSecret = this.scopedOrLegacy(
      `${prefix}_CLIENT_SECRET`,
      'OLIST_CLIENT_SECRET',
      integrationKey,
    );
    const redirectUri = this.scopedOrLegacy(
      `${prefix}_REDIRECT_URI`,
      'OLIST_REDIRECT_URI',
      integrationKey,
    );

    if (!clientId || !clientSecret || !redirectUri || !isHttpUrl(redirectUri)) {
      throw new OlistIntegrationNotConfiguredError();
    }

    return { integrationKey, clientId, clientSecret, redirectUri };
  }

  private configuredKeys(): Set<string> {
    const configured = this.optionalString('OLIST_INTEGRATION_KEYS');
    if (!configured) {
      return new Set([LEGACY_INTEGRATION_KEY]);
    }

    const keys = configured
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    return new Set(keys);
  }

  private scopedOrLegacy(
    scopedKey: string,
    legacyKey: string,
    integrationKey: string,
  ): string | undefined {
    return (
      this.optionalString(scopedKey) ??
      (integrationKey === LEGACY_INTEGRATION_KEY
        ? this.optionalString(legacyKey)
        : undefined)
    );
  }

  private optionalString(key: string): string | undefined {
    const value = this.config.get(key);
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
