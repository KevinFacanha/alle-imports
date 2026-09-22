import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV!: NodeEnvironment;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65_535)
  PORT!: number;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  WEB_ORIGIN!: string;

  @IsTimeZone()
  BUSINESS_TIMEZONE = 'America/Sao_Paulo';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  DIRECT_URL!: string;

  @IsString()
  @IsNotEmpty()
  MELI_CLIENT_ID!: string;

  @IsString()
  @IsNotEmpty()
  MELI_CLIENT_SECRET!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  MELI_REDIRECT_URI!: string;

  @IsOptional()
  @IsString()
  OLIST_INTEGRATION_KEYS?: string;

  @IsOptional()
  @IsString()
  OLIST_DEFAULT_INTEGRATION_KEY?: string;

  @IsOptional()
  @IsString()
  OLIST_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  OLIST_CLIENT_SECRET?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  OLIST_REDIRECT_URI?: string;

  @IsString()
  @IsNotEmpty()
  OAUTH_TOKEN_ENCRYPTION_KEY!: string;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  validateOlistIntegrations(environment);
  const validatedEnvironment = plainToInstance(
    EnvironmentVariables,
    environment,
    { enableImplicitConversion: true },
  );
  const errors = validateSync(validatedEnvironment, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  return validatedEnvironment;
}

function validateOlistIntegrations(
  environment: Record<string, unknown>,
): void {
  const configuredKeys = optionalString(
    environment.OLIST_INTEGRATION_KEYS,
  );
  const keys = configuredKeys
    ? configuredKeys.split(',').map((key) => key.trim())
    : ['c2'];
  const integrationKeyPattern = /^[a-z][a-z0-9_-]{0,31}$/;

  if (
    keys.length === 0 ||
    keys.some((key) => !integrationKeyPattern.test(key)) ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error('Invalid Olist integration key configuration.');
  }

  const defaultKey =
    optionalString(environment.OLIST_DEFAULT_INTEGRATION_KEY) ?? 'c2';
  if (!keys.includes(defaultKey)) {
    throw new Error(
      'The default Olist integration must be included in OLIST_INTEGRATION_KEYS.',
    );
  }

  for (const key of keys) {
    const prefix = `OLIST_${key.toUpperCase().replaceAll('-', '_')}`;
    const legacyFallback = key === 'c2';
    const clientId =
      optionalString(environment[`${prefix}_CLIENT_ID`]) ??
      (legacyFallback
        ? optionalString(environment.OLIST_CLIENT_ID)
        : undefined);
    const clientSecret =
      optionalString(environment[`${prefix}_CLIENT_SECRET`]) ??
      (legacyFallback
        ? optionalString(environment.OLIST_CLIENT_SECRET)
        : undefined);
    const redirectUri =
      optionalString(environment[`${prefix}_REDIRECT_URI`]) ??
      (legacyFallback
        ? optionalString(environment.OLIST_REDIRECT_URI)
        : undefined);

    if (!clientId || !clientSecret || !redirectUri || !isHttpUrl(redirectUri)) {
      throw new Error(`Invalid Olist integration configuration for ${key}.`);
    }
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
