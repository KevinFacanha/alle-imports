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
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.DIRECT_URL = 'postgresql://localhost:5432/test';

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

  it('redirects the Mercado Livre connect endpoint with state and PKCE', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/auth/mercado-livre/connect`,
      { redirect: 'manual' },
    );

    assert.equal(response.status, 302);
    const location = response.headers.get('location');
    assert.ok(location);
    const authorizationUrl = new URL(location);
    assert.equal(
      authorizationUrl.origin,
      'https://auth.mercadolivre.com.br',
    );
    assert.ok(authorizationUrl.searchParams.get('state'));
    assert.ok(authorizationUrl.searchParams.get('code_challenge'));
    assert.equal(
      authorizationUrl.searchParams.get('code_challenge_method'),
      'S256',
    );
  });

  it('rejects an invalid callback state without exposing credentials', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/auth/mercado-livre/callback?state=invalid&code=invalid`,
    );
    const body = await response.text();

    assert.equal(response.status, 400);
    assert.equal(body.includes('access_token'), false);
    assert.equal(body.includes('refresh_token'), false);
    assert.equal(body.includes('client_secret'), false);
  });
});
