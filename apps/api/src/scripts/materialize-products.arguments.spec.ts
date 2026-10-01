import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseProductMaterializationArguments,
  ProductMaterializationCliError,
} from './materialize-products.arguments.js';

describe('product materialization CLI arguments', () => {
  it('defaults to dry-run when --execute is absent', () => {
    assert.deepEqual(parseProductMaterializationArguments(['--plan=plan.json']), {
      planPath: 'plan.json',
      execute: false,
      candidateIds: [],
    });
  });

  it('accepts explicit execution with repeated candidate filters', () => {
    assert.deepEqual(
      parseProductMaterializationArguments([
        '--plan=plan.json',
        '--execute',
        '--candidate=PC-HIGH-001',
        '--candidate=PC-HIGH-083',
      ]),
      {
        planPath: 'plan.json',
        execute: true,
        candidateIds: ['PC-HIGH-001', 'PC-HIGH-083'],
      },
    );
  });

  it('keeps the legacy explicit --dry-run form', () => {
    assert.equal(
      parseProductMaterializationArguments([
        '--plan=plan.json',
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
          '--dry-run',
          '--execute',
        ]),
      ProductMaterializationCliError,
    );
  });
});
