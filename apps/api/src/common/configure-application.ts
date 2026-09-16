import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

import { EnvironmentVariables } from '../config/environment.validation.js';

const GLOBAL_PREFIX = 'api/v1';

export function configureApplication(
  app: INestApplication,
  configService: ConfigService<EnvironmentVariables, true>,
): void {
  const webOrigin = configService.getOrThrow<string>('WEB_ORIGIN');

  app.use(helmet());
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableCors({ origin: webOrigin });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
}
