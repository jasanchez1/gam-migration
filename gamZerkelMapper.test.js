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

// Shared segment map for segment tests
const SEG_MAP = new Map([[12345, 4560], [12346, 4561], [23456, 7890]]);

// TC1 — IS single value
test('IS single value', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(1, 'IS', [10]), K, V).zerkel,
    '"category contains \\"shoes\\""'
  );
});

// TC2 — IS multiple values
test('IS multiple values', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(1, 'IS', [10, 11]), K, V).zerkel,
    '"(category contains \\"shoes\\" or category contains \\"boots\\")"'
  );
});

// TC3 — IS_NOT single value
test('IS_NOT single value', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(2, 'IS_NOT', [20]), K, V).zerkel,
    '"not (user_type contains \\"subscriber\\")"'
  );
});

// TC4 — IS_NOT multiple values
test('IS_NOT multiple values', () => {
  assert.strictEqual(
    translateCustomTargeting(criteria(2, 'IS_NOT', [10, 11]), K, V).zerkel,
    '"not (user_type contains \\"shoes\\" or user_type contains \\"boots\\")"'
  );
});

// TC5 — AND set nested inside OR gets wrapped in parens
test('AND set nested → wrapped in parens', () => {
  const node = criteriaSet('OR', [
    criteriaSet('AND', [criteria(1, 'IS', [10]), criteria(2, 'IS', [20])]),
  ]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
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
    translateCustomTargeting(node, keys, values).zerkel,
    '"((category contains \\"mens_shoes\\" or category contains \\"running_shoes\\") and not (user_type contains \\"subscriber\\")) or (page_type contains \\"homepage\\")"'
  );
});

// TC7 — Single-child set at root → no extra parens
test('single-child set at root → no outer parens', () => {
  const node = criteriaSet('AND', [criteria(3, 'IS', [30])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
    '"page_type contains \\"homepage\\""'
  );
});

// TC7b — Single-child AND nested inside OR gets parens
test('single-child AND nested in OR → wrapped in parens', () => {
  const node = criteriaSet('OR', [criteriaSet('AND', [criteria(3, 'IS', [30])])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
    '"(page_type contains \\"homepage\\")"'
  );
});

// TC8 — Key name with hyphen normalized to underscore
test('key with hyphen normalized to underscore', () => {
  const node = criteria(4, 'IS', [30]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
    '"page_type contains \\"homepage\\""'
  );
});

// TC9 — Empty children returns ""
test('empty children returns ""', () => {
  assert.strictEqual(translateCustomTargeting(criteriaSet('AND', []), K, V).zerkel, '""');
});

// TC10 — Missing keyId → placeholder
test('missing keyId returns placeholder', () => {
  const result = translateCustomTargeting(criteria(999, 'IS', [10]), K, V).zerkel;
  assert.ok(result.includes('unknown_key_999'), `expected placeholder in: ${result}`);
});

// TC10b — Missing valueId → placeholder
test('missing valueId returns placeholder', () => {
  const result = translateCustomTargeting(criteria(1, 'IS', [999]), K, V).zerkel;
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
    segmentIds: [],
  });
});

// TC12 — collectIds leaf node
test('collectIds leaf node', () => {
  assert.deepStrictEqual(collectIds(criteria(101, 'IS', [201, 202])), {
    keyIds: [101],
    valueIds: [201, 202],
    segmentIds: [],
  });
});

// TC13 — CmsMetadataCriteria (and other unknown types) still throws
test('CmsMetadataCriteria throws Error', () => {
  assert.throws(
    () => translateCustomTargeting(
      { xsi_type: 'CmsMetadataCriteria', operator: 'IS', cmsMetadataValueIds: [99] },
      K, V
    ),
    /Unrecognized xsi_type.*CmsMetadataCriteria/
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
    translateCustomTargeting(node, K, V).zerkel,
    '"category contains \\"shoes\\" and user_type contains \\"subscriber\\""'
  );
});

// TC16 — OR at root with direct criteria children (no AND wrapper)
test('OR at root with direct criteria children', () => {
  const node = criteriaSet('OR', [criteria(1, 'IS', [10]), criteria(3, 'IS', [30])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
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
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
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
    translateCustomTargeting(node, K, V).zerkel,
    '"category contains \\"shoes\\" and user_type contains \\"subscriber\\" and page_type contains \\"homepage\\""'
  );
});

// TC19 — OR combining IS and IS_NOT at root
test('OR combining IS and IS_NOT', () => {
  const node = criteriaSet('OR', [criteria(1, 'IS', [10]), criteria(2, 'IS_NOT', [20])]);
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
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
    segmentIds: [],
  });
});

// TC21 — collectIds on empty set
test('collectIds empty set returns empty arrays', () => {
  assert.deepStrictEqual(collectIds(criteriaSet('AND', [])), {
    keyIds: [],
    valueIds: [],
    segmentIds: [],
  });
});

// TC22 — Key with multiple hyphens fully normalized
test('key with multiple hyphens normalized to underscores', () => {
  const keys = { '5': 'page-sub-type' };
  const values = { '50': 'article' };
  assert.strictEqual(
    translateCustomTargeting({ xsi_type: 'CustomCriteria', keyId: 5, operator: 'IS', valueIds: [50] }, keys, values).zerkel,
    '"page_sub_type contains \\"article\\""'
  );
});

// TC23 — null node returns ""
test('null node returns ""', () => {
  assert.strictEqual(translateCustomTargeting(null, K, V).zerkel, '""');
});

// TC24 — criteria with no valueIds returns ""
test('criteria with no valueIds returns ""', () => {
  assert.strictEqual(
    translateCustomTargeting({ xsi_type: 'CustomCriteria', keyId: 1, operator: 'IS' }, K, V).zerkel,
    '""'
  );
});

// TC25 — null child inside set is silently dropped
test('null child inside set is silently dropped', () => {
  const node = { xsi_type: 'CustomCriteriaSet', logicalOperator: 'AND', children: [null, criteria(1, 'IS', [10])] };
  assert.strictEqual(
    translateCustomTargeting(node, K, V).zerkel,
    '"category contains \\"shoes\\""'
  );
});

// TC26 — AudienceSegmentCriteria IS single mapped segment → correct zerkel, empty unsupported
test('AudienceSegmentCriteria IS single mapped segment', () => {
  const node = { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [12345] };
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '"$user.segments contains 4560"');
  assert.deepStrictEqual(unsupported, []);
});

// TC27 — AudienceSegmentCriteria IS multiple mapped → OR expression
test('AudienceSegmentCriteria IS multiple mapped segments', () => {
  const node = { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [12345, 12346] };
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '"($user.segments contains 4560 or $user.segments contains 4561)"');
  assert.deepStrictEqual(unsupported, []);
});

// TC28 — AudienceSegmentCriteria IS_NOT → not (...) expression
test('AudienceSegmentCriteria IS_NOT', () => {
  const node = { xsi_type: 'AudienceSegmentCriteria', operator: 'IS_NOT', userListIds: [12345] };
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '"not ($user.segments contains 4560)"');
  assert.deepStrictEqual(unsupported, []);
});

// TC29 — unmapped segment → empty zerkel contribution, pushed to unsupported
test('AudienceSegmentCriteria unmapped segment → unsupported', () => {
  const node = { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [99999] };
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '""');
  assert.strictEqual(unsupported.length, 1);
  assert.strictEqual(unsupported[0].xsi_type, 'AudienceSegmentCriteria');
  assert.deepStrictEqual(unsupported[0].userListIds, [99999]);
  assert.strictEqual(unsupported[0].reason, 'no segment mapping');
});

// TC30 — partially mapped → partial zerkel + unsupported
test('AudienceSegmentCriteria partially mapped', () => {
  const node = { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [12345, 99999] };
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '"$user.segments contains 4560"');
  assert.strictEqual(unsupported.length, 1);
  assert.deepStrictEqual(unsupported[0].userListIds, [99999]);
});

// TC31 — segment node mixed with CustomCriteria in AND set
test('AudienceSegmentCriteria mixed with CustomCriteria in AND', () => {
  const node = criteriaSet('AND', [
    criteria(1, 'IS', [10]),
    { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [12345] },
  ]);
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '"category contains \\"shoes\\" and $user.segments contains 4560"');
  assert.deepStrictEqual(unsupported, []);
});

// TC32 — unmapped segment mixed with CustomCriteria → only key/value part survives
test('AudienceSegmentCriteria unmapped mixed with CustomCriteria', () => {
  const node = criteriaSet('AND', [
    criteria(1, 'IS', [10]),
    { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [99999] },
  ]);
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V, SEG_MAP);
  assert.strictEqual(zerkel, '"category contains \\"shoes\\""');
  assert.strictEqual(unsupported.length, 1);
});

// TC33 — no segmentMap passed, AudienceSegmentCriteria → unsupported, no throw
test('AudienceSegmentCriteria with no segmentMap → unsupported, no throw', () => {
  const node = { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [12345] };
  const { zerkel, unsupported } = translateCustomTargeting(node, K, V);
  assert.strictEqual(zerkel, '""');
  assert.strictEqual(unsupported.length, 1);
  assert.strictEqual(unsupported[0].reason, 'no segment mapping');
});

// TC34 — collectIds includes segmentIds from AudienceSegmentCriteria
test('collectIds includes segmentIds', () => {
  const node = criteriaSet('AND', [
    criteria(101, 'IS', [201]),
    { xsi_type: 'AudienceSegmentCriteria', operator: 'IS', userListIds: [12345, 12346] },
  ]);
  assert.deepStrictEqual(collectIds(node), {
    keyIds: [101],
    valueIds: [201],
    segmentIds: [12345, 12346],
  });
});

// TC35 — segmentMap.js: loadSegmentMap parses CSV correctly
test('loadSegmentMap parses valid CSV', () => {
  const { loadSegmentMap } = require('./segmentMap');
  const path = require('path');
  const map = loadSegmentMap(path.join(__dirname, 'segmentMap.csv'));
  assert.ok(map instanceof Map);
  assert.ok(map.size >= 10);
  assert.strictEqual(map.get(12345), 4560);
  assert.strictEqual(map.get(23456), 7890);
});

// TC36 — loadSegmentMap returns empty Map for non-existent file (does not throw)
test('loadSegmentMap non-existent file returns empty Map', () => {
  const { loadSegmentMap } = require('./segmentMap');
  const map = loadSegmentMap('/tmp/does-not-exist-12345.csv');
  assert.ok(map instanceof Map);
  assert.strictEqual(map.size, 0);
});
