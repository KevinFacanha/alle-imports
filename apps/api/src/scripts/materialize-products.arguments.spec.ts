import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseProductMaterializationArguments,
  ProductMaterializationCliError,
} from './materialize-products.arguments.js';

describe('product materialization CLI arguments', () => {
  it('defaults to dry-run when --execute is absent', () => {
    assert.deepEqual(
      parseProductMaterializationArguments([
        '--plan=plan.json',
        `--expected-sha256=${'a'.repeat(64)}`,
      ]),
      {
        planPath: 'plan.json',
        expectedSha256: 'a'.repeat(64),
        execute: false,
        candidateIds: [],
      },
    );
  });

  it('accepts explicit execution with repeated candidate filters', () => {
    assert.deepEqual(
      parseProductMaterializationArguments([
        '--plan=plan.json',
        `--expected-sha256=${'b'.repeat(64)}`,
        '--execute',
        '--candidate=PC-HIGH-001',
        '--candidate=PC-HIGH-083',
      ]),
      {
        planPath: 'plan.json',
        expectedSha256: 'b'.repeat(64),
        execute: true,
        candidateIds: ['PC-HIGH-001', 'PC-HIGH-083'],
      },
    );
  });

  it('keeps the legacy explicit --dry-run form', () => {
    assert.equal(
      parseProductMaterializationArguments([
        '--plan=plan.json',
        `--expected-sha256=${'c'.repeat(64)}`,
        '--dry-run',
      ]).execute,
      false,
    );
  });

  it('rejects ambiguous dry-run and execute flags', () => {
    assert.throws(
      () =>
        parseProductMaterializationArguments([
          '--plan=plan.json',
          `--expected-sha256=${'d'.repeat(64)}`,
          '--dry-run',
          '--execute',
        ]),
      ProductMaterializationCliError,
    );
  });

  it('requires an exact lowercase SHA-256', () => {
    assert.throws(
      () => parseProductMaterializationArguments(['--plan=plan.json']),
      ProductMaterializationCliError,
    );
    assert.throws(
      () =>
        parseProductMaterializationArguments([
          '--plan=plan.json',
          '--expected-sha256=NOT-A-SHA',
        ]),
      ProductMaterializationCliError,
    );
  });
});
