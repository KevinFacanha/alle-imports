import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  it('returns the API health status', () => {
    const controller = new HealthController(new HealthService());

    assert.deepEqual(controller.getHealth(), {
      status: 'ok',
      service: 'ale-intelligence-api',
    });
  });
});
