'use strict';
/**
 * Translate a GAM LineItem.targeting.customTargeting tree into a Kevel
 * Zerkel CustomTargeting expression string.
 *
 * The returned string is wrapped in outer double-quotes with all inner
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

function buildZerkel(node, keys, values, depth) {
  if (!node || typeof node !== 'object') return '';

  if (node.xsi_type === 'CustomCriteria') {
    return translateCriteria(node, keys, values);
  }

  if (node.xsi_type === 'CustomCriteriaSet') {
    const children = (node.children || [])
      .map(child => buildZerkel(child, keys, values, depth + 1))
      .filter(expr => expr !== '');

    if (children.length === 0) return '';

    const joiner = node.logicalOperator === 'OR' ? ' or ' : ' and ';
    const joined = children.join(joiner);
    return depth > 0 ? `(${joined})` : joined;
  }

  throw new Error(`Unrecognized xsi_type: ${JSON.stringify(node.xsi_type)}`);
}

/**
 * Translate a GAM customTargeting node to a Kevel CustomTargeting string.
 *
 * @param {object} node   - GAM CustomCriteriaSet or CustomCriteria node
 * @param {object} keys   - Map of string keyId → key name, e.g. { "101": "category" }
 * @param {object} values - Map of string valueId → value string, e.g. { "201": "mens_shoes" }
 * @returns {string} Zerkel expression wrapped in outer double-quotes with inner quotes escaped
 */
function translateCustomTargeting(node, keys, values) {
  const zerkel = buildZerkel(node, keys, values, 0);
  if (!zerkel) return '""';
  return '"' + zerkel.replace(/"/g, '\\"') + '"';
}

/**
 * Collect all keyIds and valueIds from a GAM customTargeting tree.
 * Useful for batching GAM CustomTargetingService lookups before translating.
 *
 * @param {object} node - GAM CustomCriteriaSet or CustomCriteria node
 * @returns {{ keyIds: number[], valueIds: number[] }}
 */
function collectIds(node) {
  const keyIds = new Set();
  const valueIds = new Set();

  function traverse(n) {
    if (!n || typeof n !== 'object') return;
    if (n.xsi_type === 'CustomCriteria') {
      if (n.keyId !== undefined) keyIds.add(n.keyId);
      (n.valueIds || []).forEach(id => valueIds.add(id));
    } else if (n.xsi_type === 'CustomCriteriaSet') {
      (n.children || []).forEach(traverse);
    }
  }

  traverse(node);
  return {
    keyIds: [...keyIds].sort((a, b) => a - b),
    valueIds: [...valueIds].sort((a, b) => a - b),
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

  console.log(translateCustomTargeting(node, keys, values));
  console.log('\ncollectIds:', JSON.stringify(collectIds(node)));
}

if (require.main === module) main();
