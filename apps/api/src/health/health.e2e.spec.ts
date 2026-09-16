import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { configureApplication } from '../common/configure-application.js';
import { EnvironmentVariables } from '../config/environment.validation.js';

describe('GET /api/v1/health', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.WEB_ORIGIN = 'http://localhost:3000';

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    const configService = app.get(
      ConfigService<EnvironmentVariables, true>,
    );

    configureApplication(app, configService);
    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as Server;
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await app.close();
  });

  it('returns status 200, service health, and the configured CORS origin', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'http://localhost:3000',
    );
    assert.deepEqual(await response.json(), {
      status: 'ok',
      service: 'ale-intelligence-api',
    });
  });
});
