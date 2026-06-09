'use strict';
// Assumption: The only @_type values present in lineItem.targeting.customTargeting
// from a GAM export are 'CustomCriteriaSet' and 'CustomCriteria'. No other xsi:type
// values appear within the customTargeting subtree. This is consistent with the GAM
// API spec but has not been verified against a real Booking.com export. If violated
// (e.g. AudienceSegmentCriteria appears), gamZerkelMapper.js will throw
// "Unrecognized xsi_type: ..." — which is the correct, safe behavior.

const { toArray } = require('./gamClient');

/**
 * Recursively walk a GAM customTargeting node (as produced by exportData.js)
 * and return a new deep-cloned object where every `@_type` property is renamed
 * to `xsi_type`. The original input is never mutated.
 *
 * @param {object|null|undefined} node
 * @returns {object|null}
 */
function normalizeTargeting(node) {
  if (node === null || node === undefined) return null;
  if (typeof node !== 'object') return node;

  const out = {};
  for (const key of Object.keys(node)) {
    if (key === '@_type') {
      out.xsi_type = node[key];
    } else if (key === 'children') {
      out.children = toArray(node.children).map(normalizeTargeting);
    } else {
      out[key] = node[key];
    }
  }
  return out;
}

module.exports = { normalizeTargeting };
