'use strict';
/**
 * Full raw export of core Google Ad Manager (GAM) entities, for an ad-server
 * migration. For each configured entity this pages through its
 * get...ByStatement SOAP method and writes one JSON file (an array of the raw
 * GAM objects) into the output directory. It also writes a manifest.json with
 * per-entity counts/errors, a timestamp, and the network code + API version used.
 *
 * Entities exported (the chain needed to reconstruct campaigns):
 *   - Companies (advertisers + agencies)            -> companies.json
 *   - Orders (GAM's "campaigns")                    -> orders.json
 *   - LineItems                                     -> lineItems.json
 *   - Creatives                                     -> creatives.json
 *   - LineItemCreativeAssociations (LICAs)          -> lineItemCreativeAssociations.json
 *
 * Targeting and all polymorphic sub-objects are dumped RAW exactly as GAM
 * returns them. Polymorphic objects carry their discriminator as the `@_type`
 * property (from the xsi:type attribute) — note this is NOT `xsi_type`, so the
 * raw output is not directly consumable by gamZerkelMapper.js without a
 * normalization step.
 *
 * See gamClient.js for the required environment variables.
 *
 * Usage:
 *   node exportData.js [outDir]      (default: ./export)
 *   npm run export
 */

const fs = require('fs');
const path = require('path');
const { PAGE_LIMIT, buildCtx, pageThrough } = require('./gamClient');

const defaultQuery = offset => `ORDER BY id ASC LIMIT ${PAGE_LIMIT} OFFSET ${offset}`;

const ENTITIES = [
  {
    service: 'CompanyService',
    method: 'getCompaniesByStatement',
    responseKey: 'getCompaniesByStatementResponse',
    filename: 'companies.json',
  },
  {
    service: 'OrderService',
    method: 'getOrdersByStatement',
    responseKey: 'getOrdersByStatementResponse',
    filename: 'orders.json',
  },
  {
    service: 'LineItemService',
    method: 'getLineItemsByStatement',
    responseKey: 'getLineItemsByStatementResponse',
    filename: 'lineItems.json',
  },
  {
    service: 'CreativeService',
    method: 'getCreativesByStatement',
    responseKey: 'getCreativesByStatementResponse',
    filename: 'creatives.json',
  },
  {
    service: 'LineItemCreativeAssociationService',
    method: 'getLineItemCreativeAssociationsByStatement',
    responseKey: 'getLineItemCreativeAssociationsByStatementResponse',
    filename: 'lineItemCreativeAssociations.json',
    // LICAs have no `id` field, so order by lineItemId instead.
    buildQuery: offset => `ORDER BY lineItemId ASC LIMIT ${PAGE_LIMIT} OFFSET ${offset}`,
  },
];

/**
 * Export one entity: page through its statement method and write the full
 * array to <outDir>/<filename>. Returns the number of objects written.
 *
 * @param {object} entity  { service, method, responseKey, filename, buildQuery? }
 * @param {object} ctx     base request context (token/version/networkCode/applicationName)
 * @param {string} outDir
 * @returns {Promise<number>}
 */
async function exportEntity(entity, ctx, outDir) {
  const entityCtx = { ...ctx, service: entity.service };
  const items = [];
  await pageThrough(
    entity.method,
    entity.responseKey,
    entity.buildQuery || defaultQuery,
    entityCtx,
    results => {
      items.push(...results);
      process.stdout.write(`\r  ${entity.filename}: ${items.length} so far`);
    }
  );
  process.stdout.write('\n');
  fs.writeFileSync(path.join(outDir, entity.filename), JSON.stringify(items, null, 2));
  return items.length;
}

async function main() {
  const outDir = process.argv[2] || path.join(__dirname, 'export');
  fs.mkdirSync(outDir, { recursive: true });

  // Mint the token once; reuse across entities (service is overridden per entity).
  const ctx = await buildCtx('OrderService');
  console.log(`Using GAM API ${ctx.version}, network ${ctx.networkCode}`);
  console.log(`Writing to ${outDir}\n`);

  const manifest = {
    exportedAt: new Date().toISOString(),
    networkCode: ctx.networkCode,
    apiVersion: ctx.version,
    entities: {},
  };

  for (const entity of ENTITIES) {
    console.log(`Exporting ${entity.filename} (${entity.service})...`);
    try {
      const count = await exportEntity(entity, ctx, outDir);
      manifest.entities[entity.filename] = { count };
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      manifest.entities[entity.filename] = { error: err.message };
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote manifest to ${path.join(outDir, 'manifest.json')}`);

  const failed = Object.values(manifest.entities).filter(e => e.error).length;
  if (failed > 0) {
    console.error(`${failed} of ${ENTITIES.length} entities failed — see manifest.json`);
    process.exitCode = 1;
  }
}

module.exports = { ENTITIES, exportEntity };

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
