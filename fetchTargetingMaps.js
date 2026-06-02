'use strict';
/**
 * Fetch custom targeting key/value name<>id mappings from the Google Ad Manager
 * (GAM) API and write them as a JSON file in the shape consumed by
 * gamZerkelMapper.js:
 *
 *   { "keys": { "101": "category", ... }, "values": { "201": "mens_shoes", ... } }
 *
 * Uses the shared SOAP plumbing in gamClient.js. This script:
 *   1. Mints an OAuth2 access token from a service-account key (scope: dfp).
 *   2. Pages through CustomTargetingService.getCustomTargetingKeysByStatement.
 *   3. Pages through CustomTargetingService.getCustomTargetingValuesByStatement,
 *      filtering by the key IDs found above (GAM requires a customTargetingKeyId
 *      filter for value queries).
 *
 * See gamClient.js for the required environment variables.
 *
 * Usage:
 *   node fetchTargetingMaps.js [outputFile]
 *   npm run fetch-maps
 */

const fs = require('fs');
const path = require('path');
const { PAGE_LIMIT, buildCtx, pageThrough, getAccessToken } = require('./gamClient');

const KEY_BATCH = 50; // key IDs per value-query IN clause

/** Fetch all custom targeting keys → { id: name }. */
async function fetchAllKeys(ctx) {
  const keys = {};
  await pageThrough(
    'getCustomTargetingKeysByStatement',
    'getCustomTargetingKeysByStatementResponse',
    offset => `ORDER BY id ASC LIMIT ${PAGE_LIMIT} OFFSET ${offset}`,
    ctx,
    results => {
      for (const k of results) keys[String(k.id)] = k.name;
    }
  );
  return keys;
}

/** Fetch all values for the given key IDs → { id: name }. */
async function fetchAllValues(keyIds, ctx) {
  const values = {};
  for (let i = 0; i < keyIds.length; i += KEY_BATCH) {
    const batch = keyIds.slice(i, i + KEY_BATCH);
    await pageThrough(
      'getCustomTargetingValuesByStatement',
      'getCustomTargetingValuesByStatementResponse',
      offset =>
        `WHERE customTargetingKeyId IN (${batch.join(',')}) ORDER BY id ASC LIMIT ${PAGE_LIMIT} OFFSET ${offset}`,
      ctx,
      results => {
        for (const v of results) values[String(v.id)] = v.name;
      }
    );
  }
  return values;
}

async function main() {
  const ctx = await buildCtx('CustomTargetingService', { applicationName: 'GAM Targeting Export' });
  const outFile = process.argv[2] || path.join(__dirname, 'targetingMaps.json');

  console.log(`Using GAM API ${ctx.version}, network ${ctx.networkCode}`);

  console.log('Fetching custom targeting keys...');
  const keys = await fetchAllKeys(ctx);
  const keyIds = Object.keys(keys).map(Number);
  console.log(`  ${keyIds.length} keys`);

  console.log('Fetching custom targeting values...');
  const values = await fetchAllValues(keyIds, ctx);
  console.log(`  ${Object.keys(values).length} values`);

  fs.writeFileSync(outFile, JSON.stringify({ keys, values }, null, 2));
  console.log(`Wrote ${outFile}`);
}

module.exports = { fetchAllKeys, fetchAllValues, getAccessToken };

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
