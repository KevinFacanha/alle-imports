import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
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

  @IsString()
  @IsNotEmpty()
  OAUTH_TOKEN_ENCRYPTION_KEY!: string;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
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
