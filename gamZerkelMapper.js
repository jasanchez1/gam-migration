'use strict';
/**
 * Translate a GAM LineItem.targeting.customTargeting tree into a Kevel
 * Zerkel CustomTargeting expression string.
 *
 * The returned zerkel string is wrapped in outer double-quotes with all inner
 * double-quotes backslash-escaped, ready to use as a Kevel `customTargeting`
 * field value, e.g.:
 *
 *   "category contains \"mens_shoes\""
 *
 * Usage (as a module):
 *   const { translateCustomTargeting, collectIds } = require('./gamZerkelMapper');
 *
 * Usage (demo):
 *   node gamZerkelMapper.js
 */

function resolveKey(keyId, keys) {
  const name = keys[String(keyId)];
  if (name === undefined) return `unknown_key_${keyId}`;
  return name.replace(/-/g, '_');
}

function resolveValue(valueId, values) {
  const name = values[String(valueId)];
  if (name === undefined) return `unknown_value_${valueId}`;
  return name;
}

function translateCriteria(node, keys, values) {
  const valueIds = node.valueIds || [];
  if (valueIds.length === 0) return '';

  const key = resolveKey(node.keyId, keys);
  const clauses = valueIds.map(vid => `${key} contains "${resolveValue(vid, values)}"`);
  const { operator } = node;

  if (operator === 'IS') {
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(' or ')})`;
  }
  if (operator === 'IS_NOT') {
    return `not (${clauses.join(' or ')})`;
  }
  throw new Error(`Unknown operator: ${operator}`);
}

function translateSegmentCriteria(node, segmentMap, unsupported) {
  const userListIds = node.userListIds || [];
  if (userListIds.length === 0) return '';

  const mapped = [];
  const missing = [];

  for (const gamId of userListIds) {
    const kevelId = segmentMap.get(Number(gamId));
    if (kevelId !== undefined) {
      mapped.push(kevelId);
    } else {
      missing.push(Number(gamId));
    }
  }

  if (missing.length > 0) {
    unsupported.push({
      xsi_type: 'AudienceSegmentCriteria',
      userListIds: missing,
      reason: 'no segment mapping',
    });
  }

  if (mapped.length === 0) return '';

  const clauses = mapped.map(id => `$user.segments contains ${id}`);
  const { operator } = node;

  if (operator === 'IS') {
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(' or ')})`;
  }
  if (operator === 'IS_NOT') {
    return `not (${clauses.join(' or ')})`;
  }
  throw new Error(`Unknown operator for AudienceSegmentCriteria: ${operator}`);
}

function buildZerkel(node, keys, values, segmentMap, unsupported, depth) {
  if (!node || typeof node !== 'object') return '';

  if (node.xsi_type === 'CustomCriteria') {
    return translateCriteria(node, keys, values);
  }

  if (node.xsi_type === 'AudienceSegmentCriteria') {
    return translateSegmentCriteria(node, segmentMap, unsupported);
  }

  if (node.xsi_type === 'CustomCriteriaSet') {
    const children = (node.children || [])
      .map(child => buildZerkel(child, keys, values, segmentMap, unsupported, depth + 1))
      .filter(expr => expr !== '');

    if (children.length === 0) return '';

    const joiner = node.logicalOperator === 'OR' ? ' or ' : ' and ';
    const joined = children.join(joiner);
    return depth > 0 ? `(${joined})` : joined;
  }

  throw new Error(`Unrecognized xsi_type: ${JSON.stringify(node.xsi_type)}`);
}

/**
 * Translate a GAM customTargeting node to a Kevel CustomTargeting expression.
 *
 * @param {object} node   - GAM CustomCriteriaSet, CustomCriteria, or AudienceSegmentCriteria node
 * @param {object} keys   - Map of string keyId → key name, e.g. { "101": "category" }
 * @param {object} values - Map of string valueId → value string, e.g. { "201": "mens_shoes" }
 * @param {Map<number,number>} [segmentMap] - optional GAM→Kevel segment ID map.
 *   If omitted or a segment ID is missing, the node is added to unsupported.
 * @returns {{ zerkel: string, unsupported: Array }}
 */
function translateCustomTargeting(node, keys, values, segmentMap = new Map()) {
  const unsupported = [];
  const expr = buildZerkel(node, keys, values, segmentMap, unsupported, 0);
  const zerkel = !expr ? '""' : '"' + expr.replace(/"/g, '\\"') + '"';
  return { zerkel, unsupported };
}

/**
 * Collect all keyIds, valueIds, and segmentIds from a GAM customTargeting tree.
 * Useful for batching GAM lookups before translating.
 *
 * @param {object} node - GAM CustomCriteriaSet or CustomCriteria node
 * @returns {{ keyIds: number[], valueIds: number[], segmentIds: number[] }}
 */
function collectIds(node) {
  const keyIds = new Set();
  const valueIds = new Set();
  const segmentIds = new Set();

  function traverse(n) {
    if (!n || typeof n !== 'object') return;
    if (n.xsi_type === 'CustomCriteria') {
      if (n.keyId !== undefined) keyIds.add(n.keyId);
      (n.valueIds || []).forEach(id => valueIds.add(id));
    } else if (n.xsi_type === 'AudienceSegmentCriteria') {
      (n.userListIds || []).forEach(id => segmentIds.add(id));
    } else if (n.xsi_type === 'CustomCriteriaSet') {
      (n.children || []).forEach(traverse);
    }
  }

  traverse(node);
  return {
    keyIds: [...keyIds].sort((a, b) => a - b),
    valueIds: [...valueIds].sort((a, b) => a - b),
    segmentIds: [...segmentIds].sort((a, b) => a - b),
  };
}

module.exports = { translateCustomTargeting, collectIds };

function main() {
  const node = {
    xsi_type: 'CustomCriteriaSet',
    logicalOperator: 'OR',
    children: [
      {
        xsi_type: 'CustomCriteriaSet',
        logicalOperator: 'AND',
        children: [
          { xsi_type: 'CustomCriteria', keyId: 101, operator: 'IS', valueIds: [201, 202] },
          { xsi_type: 'CustomCriteria', keyId: 102, operator: 'IS_NOT', valueIds: [301] },
        ],
      },
      {
        xsi_type: 'CustomCriteriaSet',
        logicalOperator: 'AND',
        children: [
          { xsi_type: 'CustomCriteria', keyId: 103, operator: 'IS', valueIds: [401] },
        ],
      },
    ],
  };

  const keys = { '101': 'category', '102': 'user_type', '103': 'page_type' };
  const values = { '201': 'mens_shoes', '202': 'running_shoes', '301': 'subscriber', '401': 'homepage' };

  const { zerkel, unsupported } = translateCustomTargeting(node, keys, values);
  console.log(zerkel);
  if (unsupported.length) console.log('unsupported:', JSON.stringify(unsupported));
  console.log('\ncollectIds:', JSON.stringify(collectIds(node)));
}

if (require.main === module) main();
