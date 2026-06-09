'use strict';
// Assumption 1: GAM Location.id is a stable criteriaId. Google documents these
// as unique and persistent. The map can be regenerated from the geo targets CSV
// if new locations are needed.
//
// Assumption 2: DMA_REGION is not mappable from the public CSV. GAM DMA
// criteriaIds are Nielsen-proprietary. A separate DMA map would be required
// and is out of scope for this module.
//
// Assumption 3: Region codes are ISO 3166-2 subdivision codes without the
// country prefix. e.g. "NY" not "US-NY". This matches what the Kevel
// /v1/countries API returns.
//
// Assumption 4: This map was built from Google's geo targets CSV dated
// 2026-05-28. Google updates the CSV quarterly. If new locations appear in a
// GAM export, they will land in `unsupported` until the map is regenerated.

const { toArray } = require('./gamClient');
const { GEO_TARGET_MAP } = require('./geoTargetMap');

/**
 * Translate a raw GAM geoTargeting node (as produced by exportData.js) into
 * Kevel-ready geo rule objects using the static GEO_TARGET_MAP lookup.
 *
 * @param {object|null|undefined} geoTargeting
 * @returns {{ rules: object[], unsupported: object[] }}
 */
function translateGeoTargeting(geoTargeting) {
  if (geoTargeting === null || geoTargeting === undefined) {
    return { rules: [], unsupported: [] };
  }

  const rules = [];
  const unsupported = [];

  function processLocation(loc, isExclude) {
    const entry = GEO_TARGET_MAP[loc.id];
    if (entry) {
      const rule = { CountryCode: entry.CountryCode, IsExclude: isExclude };
      if (entry.Region !== undefined) rule.Region = entry.Region;
      rules.push(rule);
    } else {
      unsupported.push({
        id: loc.id,
        type: loc.type,
        displayName: loc.displayName,
        IsExclude: isExclude,
        reason: 'not in GEO_TARGET_MAP',
      });
    }
  }

  for (const loc of toArray(geoTargeting.targetedLocations)) {
    processLocation(loc, false);
  }
  for (const loc of toArray(geoTargeting.excludedLocations)) {
    processLocation(loc, true);
  }

  return { rules, unsupported };
}

module.exports = { translateGeoTargeting };
