'use strict';
/**
 * Shared Google Ad Manager (GAM) SOAP plumbing: OAuth token minting, SOAP
 * envelope POST, PQL statement paging, and small helpers. Consumed by both
 * fetchTargetingMaps.js and exportData.js.
 *
 * GAM exposes only a SOAP/XML API. Authentication is an OAuth2 access token
 * minted from a service-account key (scope: dfp). The service account must be
 * added as an API user in the GAM network (Admin > Global settings > API access).
 *
 * The XML parser PRESERVES attributes (notably xsi:type), which GAM uses to
 * discriminate polymorphic objects (e.g. ImageCreative vs ThirdPartyCreative,
 * CustomCriteriaSet vs CustomCriteria). With the config below the discriminator
 * lands as the `@_type` property — the `@_` prefix keeps it distinct from real
 * element fields named `type` (e.g. Company.type).
 *
 * Required environment (e.g. via a .env file — see .env.example):
 *   GAM_NETWORK_CODE              - your GAM network code
 *   GAM_SERVICE_ACCOUNT_KEY_FILE  - path to the service-account JSON key
 * Optional:
 *   GAM_APPLICATION_NAME          - arbitrary app name string (default below)
 *   GAM_API_VERSION               - GAM API version, e.g. v202508 (default below)
 */

const fs = require('fs');
require('dotenv').config();
const { JWT } = require('google-auth-library');
const { XMLParser } = require('fast-xml-parser');

const DEFAULT_API_VERSION = 'v202508';
const DFP_SCOPE = 'https://www.googleapis.com/auth/dfp';
const PAGE_LIMIT = 500; // GAM max results per statement page

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Mint a GAM access token from a service-account JSON key file. */
async function getAccessToken(keyFile) {
  const credentials = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [DFP_SCOPE],
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain an access token from the service account.');
  return token;
}

/**
 * Build the request context shared by every SOAP call: reads the GAM_* env
 * vars, mints an access token, and records the target service.
 *
 * @param {string} service  GAM service name, e.g. 'OrderService'
 * @param {object} [opts]   { applicationName?: string }
 * @returns {Promise<{token:string,version:string,networkCode:string,applicationName:string,service:string}>}
 */
async function buildCtx(service, opts = {}) {
  return {
    service,
    networkCode: reqEnv('GAM_NETWORK_CODE'),
    applicationName:
      opts.applicationName || process.env.GAM_APPLICATION_NAME || 'GAM Migration Export',
    version: process.env.GAM_API_VERSION || DEFAULT_API_VERSION,
    token: await getAccessToken(reqEnv('GAM_SERVICE_ACCOUNT_KEY_FILE')),
  };
}

/**
 * POST a SOAP envelope to ctx.service and return the parsed soap:Body.
 * Throws on SOAP faults or HTTP errors.
 *
 * @param {string} method    e.g. 'getOrdersByStatement'
 * @param {string} innerXml  inner body XML (already escaped)
 * @param {object} ctx       { token, version, networkCode, applicationName, service }
 */
async function soapCall(method, innerXml, ctx) {
  const ns = `https://www.google.com/apis/ads/publisher/${ctx.version}`;
  const endpoint = `https://ads.google.com/apis/ads/publisher/${ctx.version}/${ctx.service}`;
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${ns}">` +
    `<soap:Header><ns:RequestHeader>` +
    `<ns:networkCode>${escapeXml(ctx.networkCode)}</ns:networkCode>` +
    `<ns:applicationName>${escapeXml(ctx.applicationName)}</ns:applicationName>` +
    `</ns:RequestHeader></soap:Header>` +
    `<soap:Body><ns:${method}>${innerXml}</ns:${method}></soap:Body>` +
    `</soap:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
      Authorization: `Bearer ${ctx.token}`,
    },
    body: envelope,
  });

  const text = await res.text();
  const parsed = parser.parse(text);
  const body = parsed && parsed.Envelope && parsed.Envelope.Body;

  if (body && body.Fault) {
    const fault = body.Fault;
    throw new Error(`GAM SOAP fault: ${fault.faultstring || JSON.stringify(fault)}`);
  }
  if (!res.ok) {
    throw new Error(`GAM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!body) {
    throw new Error(`Unexpected GAM response: ${text.slice(0, 500)}`);
  }
  return body;
}

/**
 * Page through a "...ByStatement" call, invoking onResults(results) for each
 * page. `buildQuery(offset)` returns the PQL query string for a given offset.
 * Stops when a short page is returned or offset >= totalResultSetSize.
 *
 * @param {string} method
 * @param {string} responseKey   e.g. 'getOrdersByStatementResponse'
 * @param {(offset:number)=>string} buildQuery
 * @param {object} ctx
 * @param {(results:object[])=>void} onResults
 */
async function pageThrough(method, responseKey, buildQuery, ctx, onResults) {
  let offset = 0;
  for (;;) {
    const query = buildQuery(offset);
    const inner = `<ns:filterStatement><ns:query>${escapeXml(query)}</ns:query></ns:filterStatement>`;
    const body = await soapCall(method, inner, ctx);
    const rval = body[responseKey] && body[responseKey].rval;
    const results = toArray(rval && rval.results);
    onResults(results);

    const total = Number((rval && rval.totalResultSetSize) || 0);
    offset += results.length;
    if (results.length === 0 || results.length < PAGE_LIMIT || offset >= total) break;
  }
}

module.exports = {
  DEFAULT_API_VERSION,
  DFP_SCOPE,
  PAGE_LIMIT,
  reqEnv,
  escapeXml,
  toArray,
  getAccessToken,
  buildCtx,
  soapCall,
  pageThrough,
};
