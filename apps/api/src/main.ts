import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';

import { AppModule } from './app.module.js';
import { configureApplication } from './common/configure-application.js';
import { EnvironmentVariables } from './config/environment.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(
    ConfigService<EnvironmentVariables, true>,
  );

  configureApplication(app, configService);

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start the API', error);
  process.exitCode = 1;
});
