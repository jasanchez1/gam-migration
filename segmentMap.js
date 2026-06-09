'use strict';
// Assumption 1: Segment mapping is manual. GAM and Kevel segment IDs are
// account-specific and provider-specific. There is no programmatic way to
// derive the mapping.
//
// Assumption 2: The CSV is loaded synchronously at module load time. It is
// expected to be a small file (hundreds of rows at most). If it grows
// significantly, switch to async loading.
//
// Assumption 3: A missing CSV is not a fatal error. loadSegmentMap returns an
// empty Map if the file does not exist, allowing the rest of the translation
// to proceed with all segments going to unsupported.

const fs = require('fs');

/**
 * Load a GAM→Kevel segment mapping CSV and return it as a Map.
 *
 * @param {string} csvPath - absolute path to the CSV file
 * @returns {Map<number, number>}  gamSegmentId → kevelSegmentId
 */
function loadSegmentMap(csvPath) {
  let content;
  try {
    content = fs.readFileSync(csvPath, 'utf8');
  } catch (err) {
    return new Map();
  }

  const map = new Map();
  let headerSkipped = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (!headerSkipped) {
      headerSkipped = true;
      continue; // skip the header row
    }

    const cols = line.split(',');
    if (cols.length < 2) {
      console.warn(`[segmentMap] skipping malformed row: ${line}`);
      continue;
    }

    const gamId = parseInt(cols[0], 10);
    const kevelId = parseInt(cols[1], 10);

    if (isNaN(gamId) || isNaN(kevelId)) {
      console.warn(`[segmentMap] skipping row with non-integer IDs: ${line}`);
      continue;
    }

    map.set(gamId, kevelId);
  }

  return map;
}

module.exports = { loadSegmentMap };
