'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { translateCustomTargeting, collectIds } = require('./gamZerkelMapper');

function criteria(keyId, operator, valueIds) {
  return { xsi_type: 'CustomCriteria', keyId, operator, valueIds };
}

function criteriaSet(logicalOperator, children) {
  return { xsi_type: 'CustomCriteriaSet', logicalOperator, children };
}

const K = { '1': 'category', '2': 'user_type', '3': 'page_type', '4': 'page-type' };
const V = { '10': 'shoes', '11': 'boots', '20': 'subscriber', '30': 'homepage' };

// TC1 — IS single value
test('IS single value', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(1, 'IS', [10]), K, V),
    '"category contains \\"shoes\\""'
  );
});

// TC2 — IS multiple values
test('IS multiple values', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(1, 'IS', [10, 11]), K, V),
    '"(category contains \\"shoes\\" or category contains \\"boots\\")"'
  );
});

// TC3 — IS_NOT single value
test('IS_NOT single value', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(2, 'IS_NOT', [20]), K, V),
    '"not (user_type contains \\"subscriber\\")"'
  );
});

// TC4 — IS_NOT multiple values
test('IS_NOT multiple values', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(2, 'IS_NOT', [10, 11]), K, V),
    '"not (user_type contains \\"shoes\\" or user_type contains \\"boots\\")"'
  );
});

// TC5 — AND set nested inside OR gets wrapped in parens
test('AND set nested → wrapped in parens', () => {
  const node = criteriaSet('OR', [
    criteriaSet('AND', [criteria(1, 'IS', [10]), criteria(2, 'IS', [20])]),
  ]);
  // OR has 1 child → returns child as-is; AND at depth=1 with 2 children → (... and ...)
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"(category contains \\"shoes\\" and user_type contains \\"subscriber\\")"'
  );
});

// TC6 — Full example from requirements
test('full example', () => {
  const node = criteriaSet('OR', [
    criteriaSet('AND', [
      criteria(1, 'IS', [10, 11]),
      criteria(2, 'IS_NOT', [20]),
    ]),
    criteriaSet('AND', [criteria(3, 'IS', [30])]),
  ]);
  const keys = { '1': 'category', '2': 'user_type', '3': 'page_type' };
  const values = { '10': 'mens_shoes', '11': 'running_shoes', '20': 'subscriber', '30': 'homepage' };
  assert.strictEqual(
    translateCustomTargeting(node, keys, values),
    '"((category contains \\"mens_shoes\\" or category contains \\"running_shoes\\") and not (user_type contains \\"subscriber\\")) or (page_type contains \\"homepage\\")"'
  );
});

// TC7 — Single-child set at root → no extra parens
test('single-child set at root → no outer parens', () => {
  const node = criteriaSet('AND', [criteria(3, 'IS', [30])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"page_type contains \\"homepage\\""'
  );
});

// TC7b — Single-child AND nested inside OR gets parens (it's one node in a potential multi-sibling context)
test('single-child AND nested in OR → wrapped in parens', () => {
  const node = criteriaSet('OR', [criteriaSet('AND', [criteria(3, 'IS', [30])])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"(page_type contains \\"homepage\\")"'
  );
});

// TC8 — Key name with hyphen normalized to underscore
test('key with hyphen normalized to underscore', () => {
  const node = criteria(4, 'IS', [30]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"page_type contains \\"homepage\\""'
  );
});

// TC9 — Empty children returns ""
test('empty children returns ""', () => {
  assert.strictEqual(translateCustomTargeting(criteriaSet('AND', []), K, V), '""');
});

// TC10 — Missing keyId → placeholder
test('missing keyId returns placeholder', () => {
  const result = translateCustomTargeting(criteria(999, 'IS', [10]), K, V);
  assert.ok(result.includes('unknown_key_999'), `expected placeholder in: ${result}`);
});

// TC10b — Missing valueId → placeholder
test('missing valueId returns placeholder', () => {
  const result = translateCustomTargeting(criteria(1, 'IS', [999]), K, V);
  assert.ok(result.includes('unknown_value_999'), `expected placeholder in: ${result}`);
});

// TC11 — collectIds full tree traversal
test('collectIds full tree', () => {
  const node = criteriaSet('OR', [
    criteriaSet('AND', [
      criteria(101, 'IS', [201, 202]),
      criteria(102, 'IS_NOT', [301]),
    ]),
    criteriaSet('AND', [criteria(103, 'IS', [401])]),
  ]);
  assert.deepStrictEqual(collectIds(node), {
    keyIds: [101, 102, 103],
    valueIds: [201, 202, 301, 401],
  });
});

// TC12 — collectIds leaf node
test('collectIds leaf node', () => {
  assert.deepStrictEqual(collectIds(criteria(101, 'IS', [201, 202])), {
    keyIds: [101],
    valueIds: [201, 202],
  });
});

// TC13 — Unrecognized xsi_type throws
test('unrecognized xsi_type throws Error', () => {
  assert.throws(
    () => translateCustomTargeting({ xsi_type: 'Unknown', children: [] }, K, V),
    /Unrecognized xsi_type/
  );
});

// TC14 — Unrecognized operator throws
test('unrecognized operator throws Error', () => {
  assert.throws(
    () => translateCustomTargeting(criteria(1, 'CONTAINS', [10]), K, V),
    /Unknown operator/
  );
});

// TC15 — AND at root with multiple criteria (depth=0, no outer parens)
test('AND at root with multiple criteria → no outer parens', () => {
  const node = criteriaSet('AND', [criteria(1, 'IS', [10]), criteria(2, 'IS', [20])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"category contains \\"shoes\\" and user_type contains \\"subscriber\\""'
  );
});

// TC16 — OR at root with direct criteria children (no AND wrapper)
test('OR at root with direct criteria children', () => {
  const node = criteriaSet('OR', [criteria(1, 'IS', [10]), criteria(3, 'IS', [30])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"category contains \\"shoes\\" or page_type contains \\"homepage\\""'
  );
});

// TC17 — Three-level nesting: OR > AND > OR > criteria
test('three-level nesting (OR > AND > OR > criteria)', () => {
  const node = criteriaSet('OR', [
    criteriaSet('AND', [
      criteriaSet('OR', [criteria(1, 'IS', [10]), criteria(1, 'IS', [11])]),
      criteria(2, 'IS', [20]),
    ]),
  ]);
  // depth=0: OR(1 child) → no outer wrap
  // depth=1: AND(2 children) → (... and ...)
  // depth=2: OR(2 children) → (... or ...)
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"((category contains \\"shoes\\" or category contains \\"boots\\") and user_type contains \\"subscriber\\")"'
  );
});

// TC18 — Three criteria joined by AND at root
test('three criteria joined by AND at root', () => {
  const node = criteriaSet('AND', [
    criteria(1, 'IS', [10]),
    criteria(2, 'IS', [20]),
    criteria(3, 'IS', [30]),
  ]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"category contains \\"shoes\\" and user_type contains \\"subscriber\\" and page_type contains \\"homepage\\""'
  );
});

// TC19 — OR combining IS and IS_NOT at root
test('OR combining IS and IS_NOT', () => {
  const node = criteriaSet('OR', [criteria(1, 'IS', [10]), criteria(2, 'IS_NOT', [20])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"category contains \\"shoes\\" or not (user_type contains \\"subscriber\\")"'
  );
});

// TC20 — collectIds deduplicates repeated keyIds and valueIds
test('collectIds deduplicates ids', () => {
  const node = criteriaSet('OR', [
    criteria(101, 'IS', [201, 202]),
    criteria(101, 'IS_NOT', [201, 203]),
  ]);
  assert.deepStrictEqual(collectIds(node), {
    keyIds: [101],
    valueIds: [201, 202, 203],
  });
});

// TC21 — collectIds on empty set
test('collectIds empty set returns empty arrays', () => {
  assert.deepStrictEqual(collectIds(criteriaSet('AND', [])), {
    keyIds: [],
    valueIds: [],
  });
});

// TC22 — Key with multiple hyphens fully normalized
test('key with multiple hyphens normalized to underscores', () => {
  const keys = { '5': 'page-sub-type' };
  const values = { '50': 'article' };
  assert.strictEqual(
    translateCustomTargeting({ xsi_type: 'CustomCriteria', keyId: 5, operator: 'IS', valueIds: [50] }, keys, values),
    '"page_sub_type contains \\"article\\""'
  );
});

// TC23 — null node returns ""
test('null node returns ""', () => {
  assert.strictEqual(translateCustomTargeting(null, K, V), '""');
});

// TC24 — criteria with no valueIds returns ""
test('criteria with no valueIds returns ""', () => {
  assert.strictEqual(
    translateCustomTargeting({ xsi_type: 'CustomCriteria', keyId: 1, operator: 'IS' }, K, V),
    '""'
  );
});

// TC25 — null child inside set is silently dropped
test('null child inside set is silently dropped', () => {
  const node = { xsi_type: 'CustomCriteriaSet', logicalOperator: 'AND', children: [null, criteria(1, 'IS', [10])] };
  assert.strictEqual(
    translateCustomTargeting(node, K, V),
    '"category contains \\"shoes\\""'
  );
});
