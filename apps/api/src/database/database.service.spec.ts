import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { DatabaseService } from './database.service.js';

describe('DatabaseService integration', () => {
  const database = new DatabaseService();

  before(async () => {
    await database.$connect();
  });

  after(async () => {
    await database.onModuleDestroy();
  });

  it('connects to PostgreSQL and executes a read-only query', async () => {
    const result = await database.$queryRaw<Array<{ connected: number }>>`
      SELECT 1 AS connected
    `;

    assert.equal(result[0]?.connected, 1);
  });
});
