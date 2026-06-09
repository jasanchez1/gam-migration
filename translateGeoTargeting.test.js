'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { translateGeoTargeting } = require('./translateGeoTargeting');

// T01 — Country by criteriaId → correct CountryCode, IsExclude: false
test('T01: country criteriaId → CountryCode rule, IsExclude false', () => {
  const { rules, unsupported } = translateGeoTargeting({
    targetedLocations: [{ id: 2840, type: 'COUNTRY', canonicalParentId: 0, displayName: 'United States' }],
  });
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0], { CountryCode: 'US', IsExclude: false });
  assert.strictEqual(unsupported.length, 0);
});

// T02 — Country excluded → IsExclude: true
test('T02: country excluded → IsExclude true', () => {
  const { rules } = translateGeoTargeting({
    excludedLocations: [{ id: 2276, type: 'COUNTRY', canonicalParentId: 0, displayName: 'Germany' }],
  });
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0], { CountryCode: 'DE', IsExclude: true });
});

// T03 — US state by criteriaId → rule has CountryCode: 'US' and correct Region
test('T03: US state criteriaId → CountryCode US and Region NY', () => {
  const { rules, unsupported } = translateGeoTargeting({
    targetedLocations: [{ id: 21167, type: 'STATE', canonicalParentId: 2840, displayName: 'New York' }],
  });
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0], { CountryCode: 'US', Region: 'NY', IsExclude: false });
  assert.strictEqual(unsupported.length, 0);
});

// T04 — DE state by criteriaId → rule has CountryCode: 'DE' and correct Region
test('T04: DE state criteriaId → CountryCode DE and Region BY', () => {
  const { rules } = translateGeoTargeting({
    targetedLocations: [{ id: 20229, type: 'STATE', canonicalParentId: 2276, displayName: 'Bavaria' }],
  });
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0], { CountryCode: 'DE', Region: 'BY', IsExclude: false });
});

// T05 — NL province by criteriaId → rule has CountryCode: 'NL' and correct Region
test('T05: NL province criteriaId → CountryCode NL and Region NH', () => {
  const { rules } = translateGeoTargeting({
    targetedLocations: [{ id: 20766, type: 'Province', canonicalParentId: 2528, displayName: 'North Holland' }],
  });
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0], { CountryCode: 'NL', Region: 'NH', IsExclude: false });
});

// T06 — Unknown criteriaId (e.g. a city) → goes to unsupported with reason field
test('T06: unknown criteriaId → unsupported with reason', () => {
  const { rules, unsupported } = translateGeoTargeting({
    targetedLocations: [{ id: 1023191, type: 'CITY', canonicalParentId: 21167, displayName: 'New York City' }],
  });
  assert.strictEqual(rules.length, 0);
  assert.strictEqual(unsupported.length, 1);
  assert.strictEqual(unsupported[0].id, 1023191);
  assert.strictEqual(unsupported[0].type, 'CITY');
  assert.strictEqual(unsupported[0].displayName, 'New York City');
  assert.strictEqual(unsupported[0].reason, 'not in GEO_TARGET_MAP');
});

// T07 — DMA_REGION criteriaId (not in map) → goes to unsupported
test('T07: DMA_REGION criteriaId → unsupported', () => {
  const { rules, unsupported } = translateGeoTargeting({
    targetedLocations: [{ id: 9057744, type: 'DMA_REGION', canonicalParentId: 2840, displayName: 'New York, NY' }],
  });
  assert.strictEqual(rules.length, 0);
  assert.strictEqual(unsupported.length, 1);
  assert.strictEqual(unsupported[0].type, 'DMA_REGION');
  assert.strictEqual(unsupported[0].reason, 'not in GEO_TARGET_MAP');
});

// T08 — Mixed input: some mapped, some not → correct split
test('T08: mixed input → correct split across rules and unsupported', () => {
  const { rules, unsupported } = translateGeoTargeting({
    targetedLocations: [
      { id: 2840, type: 'COUNTRY', canonicalParentId: 0, displayName: 'United States' },
      { id: 1023191, type: 'CITY', canonicalParentId: 21167, displayName: 'New York City' },
    ],
    excludedLocations: [
      { id: 21167, type: 'STATE', canonicalParentId: 2840, displayName: 'New York' },
    ],
  });
  assert.strictEqual(rules.length, 2);
  assert.strictEqual(unsupported.length, 1);
  assert.strictEqual(rules[0].CountryCode, 'US');
  assert.strictEqual(rules[0].IsExclude, false);
  assert.strictEqual(rules[1].Region, 'NY');
  assert.strictEqual(rules[1].IsExclude, true);
});

// T09 — null input → { rules: [], unsupported: [] }, no throw
test('T09: null input → empty result, no throw', () => {
  assert.deepStrictEqual(translateGeoTargeting(null), { rules: [], unsupported: [] });
});

// T10 — undefined input → { rules: [], unsupported: [] }, no throw
test('T10: undefined input → empty result, no throw', () => {
  assert.deepStrictEqual(translateGeoTargeting(undefined), { rules: [], unsupported: [] });
});

// T11 — Empty object input → { rules: [], unsupported: [] }
test('T11: empty object → empty result', () => {
  assert.deepStrictEqual(translateGeoTargeting({}), { rules: [], unsupported: [] });
});

// T12 — targetedLocations is a single object not in an array → still works
test('T12: targetedLocations single object → coerced correctly', () => {
  const { rules } = translateGeoTargeting({
    targetedLocations: { id: 2250, type: 'COUNTRY', canonicalParentId: 0, displayName: 'France' },
  });
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].CountryCode, 'FR');
});

// T13 — excludedLocations is a single object not in an array → still works
test('T13: excludedLocations single object → coerced correctly', () => {
  const { rules } = translateGeoTargeting({
    excludedLocations: { id: 2392, type: 'COUNTRY', canonicalParentId: 0, displayName: 'Japan' },
  });
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].CountryCode, 'JP');
  assert.strictEqual(rules[0].IsExclude, true);
});

// T14 — IsExclude is boolean false (not string) for targeted
test('T14: IsExclude is boolean false for targeted locations', () => {
  const { rules } = translateGeoTargeting({
    targetedLocations: [{ id: 2840, type: 'COUNTRY', canonicalParentId: 0, displayName: 'United States' }],
  });
  assert.strictEqual(typeof rules[0].IsExclude, 'boolean');
  assert.strictEqual(rules[0].IsExclude, false);
});

// T15 — IsExclude is boolean true (not string) for excluded
test('T15: IsExclude is boolean true for excluded locations', () => {
  const { rules } = translateGeoTargeting({
    excludedLocations: [{ id: 2840, type: 'COUNTRY', canonicalParentId: 0, displayName: 'United States' }],
  });
  assert.strictEqual(typeof rules[0].IsExclude, 'boolean');
  assert.strictEqual(rules[0].IsExclude, true);
});

// T16 — No FlightId field present on any rule object
test('T16: no FlightId on any rule object', () => {
  const { rules } = translateGeoTargeting({
    targetedLocations: [
      { id: 2840, type: 'COUNTRY', canonicalParentId: 0, displayName: 'United States' },
      { id: 21167, type: 'STATE', canonicalParentId: 2840, displayName: 'New York' },
    ],
  });
  for (const rule of rules) {
    assert.ok(!('FlightId' in rule), `FlightId found on rule: ${JSON.stringify(rule)}`);
  }
});

// T17 — unsupported entry preserves original id, type, displayName, IsExclude, and reason
test('T17: unsupported entry preserves all expected fields', () => {
  const { unsupported } = translateGeoTargeting({
    excludedLocations: [{ id: 9999999, type: 'POSTAL_CODE', canonicalParentId: 21167, displayName: '10001' }],
  });
  assert.strictEqual(unsupported.length, 1);
  assert.strictEqual(unsupported[0].id, 9999999);
  assert.strictEqual(unsupported[0].type, 'POSTAL_CODE');
  assert.strictEqual(unsupported[0].displayName, '10001');
  assert.strictEqual(unsupported[0].IsExclude, true);
  assert.strictEqual(unsupported[0].reason, 'not in GEO_TARGET_MAP');
});
