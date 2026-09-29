import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertSafeTestDatabaseEnvironment } from './test-database-safety.js';

const disposableDatabase =
  'postgresql://test_user:test_password@127.0.0.1:55432/ale_intelligence_test';

describe('test database safety', () => {
  it('allows an explicitly opted-in disposable database on an isolated local port', () => {
    assert.doesNotThrow(() =>
      assertSafeTestDatabaseEnvironment({
        NODE_ENV: 'test',
        ALLOW_DISPOSABLE_TEST_DATABASE: 'true',
        DATABASE_URL: disposableDatabase,
        DIRECT_URL: disposableDatabase,
      }),
    );
  });

  it('rejects Supabase in test mode even with the disposable database opt-in', () => {
    assert.throws(
      () =>
        assertSafeTestDatabaseEnvironment({
          NODE_ENV: 'test',
          ALLOW_DISPOSABLE_TEST_DATABASE: 'true',
          DATABASE_URL:
            'postgresql://user:secret@db.example.supabase.co:5432/postgres',
          DIRECT_URL:
            'postgresql://user:secret@db.example.supabase.co:5432/postgres',
        }),
      /must target a loopback host/,
    );
  });

  it('rejects test database access without the explicit opt-in', () => {
    assert.throws(
      () =>
        assertSafeTestDatabaseEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: disposableDatabase,
          DIRECT_URL: disposableDatabase,
        }),
      /requires ALLOW_DISPOSABLE_TEST_DATABASE=true/,
    );
  });

  it('does not restrict an authorized non-test process', () => {
    assert.doesNotThrow(() =>
      assertSafeTestDatabaseEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://user:secret@db.example.supabase.co:5432/postgres',
        DIRECT_URL:
          'postgresql://user:secret@db.example.supabase.co:5432/postgres',
      }),
    );
  });
});
