'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTargeting } = require('./normalizeTargeting');
const { translateCustomTargeting } = require('./gamZerkelMapper');

// N01 — CustomCriteria node: @_type renamed to xsi_type, value unchanged
test('N01: CustomCriteria @_type renamed to xsi_type', () => {
  const input = { '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10] };
  const result = normalizeTargeting(input);
  assert.strictEqual(result.xsi_type, 'CustomCriteria');
  assert.ok(!('@_type' in result));
  assert.strictEqual(result.keyId, 1);
  assert.strictEqual(result.operator, 'IS');
  assert.deepStrictEqual(result.valueIds, [10]);
});

// N02 — CustomCriteriaSet node: @_type renamed, children recursed
test('N02: CustomCriteriaSet @_type renamed and children recursed', () => {
  const input = {
    '@_type': 'CustomCriteriaSet',
    logicalOperator: 'AND',
    children: [{ '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10] }],
  };
  const result = normalizeTargeting(input);
  assert.strictEqual(result.xsi_type, 'CustomCriteriaSet');
  assert.ok(!('@_type' in result));
  assert.strictEqual(result.children[0].xsi_type, 'CustomCriteria');
  assert.ok(!('@_type' in result.children[0]));
});

// N03 — Nested tree: all nodes at all depths get xsi_type, no @_type anywhere
test('N03: nested tree — no @_type anywhere in output', () => {
  const input = {
    '@_type': 'CustomCriteriaSet',
    logicalOperator: 'OR',
    children: [
      {
        '@_type': 'CustomCriteriaSet',
        logicalOperator: 'AND',
        children: [
          { '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10] },
          { '@_type': 'CustomCriteria', keyId: 2, operator: 'IS_NOT', valueIds: [20] },
        ],
      },
    ],
  };
  const result = normalizeTargeting(input);
  function hasAtType(obj) {
    if (typeof obj !== 'object' || obj === null) return false;
    if ('@_type' in obj) return true;
    return Object.values(obj).some(v => Array.isArray(v) ? v.some(hasAtType) : hasAtType(v));
  }
  assert.ok(!hasAtType(result));
  assert.strictEqual(result.xsi_type, 'CustomCriteriaSet');
  assert.strictEqual(result.children[0].xsi_type, 'CustomCriteriaSet');
  assert.strictEqual(result.children[0].children[0].xsi_type, 'CustomCriteria');
  assert.strictEqual(result.children[0].children[1].xsi_type, 'CustomCriteria');
});

// N04 — Input is not mutated
test('N04: input object is not mutated', () => {
  const input = {
    '@_type': 'CustomCriteriaSet',
    logicalOperator: 'AND',
    children: [{ '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10] }],
  };
  normalizeTargeting(input);
  assert.ok('@_type' in input);
  assert.strictEqual(input['@_type'], 'CustomCriteriaSet');
  assert.ok('@_type' in input.children[0]);
});

// N05 — null input returns null
test('N05: null input returns null', () => {
  assert.strictEqual(normalizeTargeting(null), null);
});

// N06 — undefined input returns null
test('N06: undefined input returns null', () => {
  assert.strictEqual(normalizeTargeting(undefined), null);
});

// N07 — Node with no @_type passes through unchanged
test('N07: node without @_type preserves other properties', () => {
  const input = { keyId: 5, operator: 'IS', valueIds: [50] };
  const result = normalizeTargeting(input);
  assert.deepStrictEqual(result, { keyId: 5, operator: 'IS', valueIds: [50] });
  assert.ok(!('xsi_type' in result));
});

// N08 — children as a single object (not array) coerced to array, child is recursed
test('N08: single-object children coerced to array and recursed', () => {
  const input = {
    '@_type': 'CustomCriteriaSet',
    logicalOperator: 'AND',
    children: { '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10] },
  };
  const result = normalizeTargeting(input);
  assert.ok(Array.isArray(result.children));
  assert.strictEqual(result.children.length, 1);
  assert.strictEqual(result.children[0].xsi_type, 'CustomCriteria');
  assert.ok(!('@_type' in result.children[0]));
});

// N09 — Empty children array returns node with empty children array
test('N09: empty children array preserved as empty array', () => {
  const input = { '@_type': 'CustomCriteriaSet', logicalOperator: 'AND', children: [] };
  const result = normalizeTargeting(input);
  assert.ok(Array.isArray(result.children));
  assert.strictEqual(result.children.length, 0);
});

// N10 — valueIds array is copied as-is, values not recursed
test('N10: valueIds array copied as-is', () => {
  const input = { '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10, 20, 30] };
  const result = normalizeTargeting(input);
  assert.deepStrictEqual(result.valueIds, [10, 20, 30]);
});

// N11 — End-to-end: normalizeTargeting output passes into translateCustomTargeting
test('N11: end-to-end wiring with translateCustomTargeting', () => {
  const raw = {
    '@_type': 'CustomCriteriaSet',
    logicalOperator: 'AND',
    children: [
      { '@_type': 'CustomCriteria', keyId: 1, operator: 'IS', valueIds: [10] },
    ],
  };
  const keys = { '1': 'category' };
  const values = { '10': 'shoes' };
  const normalized = normalizeTargeting(raw);
  const result = translateCustomTargeting(normalized, keys, values);
  assert.strictEqual(result, '"category contains \\"shoes\\""');
});
