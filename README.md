# GAM → Kevel Targeting Migration

Translates Google Ad Manager (GAM) line-item custom key-value targeting into
Kevel [Zerkel](https://dev.kevel.com/docs/custom-targeting) `CustomTargeting`
expression strings.

## The problem

In GAM, `LineItem.targeting.customTargeting` is **not** a flat list of
`key=value` strings. It's a nested boolean tree:

- A **`CustomCriteriaSet`** has a `logicalOperator` (`AND` / `OR`) and a list of
  `children` (more sets, or leaves).
- A **`CustomCriteria`** leaf references targeting by **ID**: a `keyId`, a list
  of `valueIds`, and an `operator` (`IS` / `IS_NOT`).

Those IDs must be resolved to readable names via GAM's `CustomTargetingService`
before they mean anything. Kevel, by contrast, expresses the same boolean logic
as a single Zerkel string using `and` / `or` / `not` / `contains` and
parentheses — so a GAM tree maps cleanly onto it.

## What this does

Given a resolved GAM `customTargeting` node plus key/value lookup maps, it emits
a Kevel `CustomTargeting` string that is **wrapped in outer double-quotes with
inner quotes backslash-escaped**, ready to drop straight into a Kevel API
payload.

### Example

GAM tree:

```
OR(
  AND(category IS [mens_shoes, running_shoes], user_type IS_NOT [subscriber]),
  AND(page_type IS [homepage])
)
```

Output:

```
"((category contains \"mens_shoes\" or category contains \"running_shoes\") and not (user_type contains \"subscriber\")) or (page_type contains \"homepage\")"
```

## Files

| File | Purpose |
|---|---|
| `gamZerkelMapper.js` | The mapper module + a runnable demo |
| `gamZerkelMapper.test.js` | Unit tests (`node:test`, no dependencies) |
| `segmentMap.csv` | Human-maintained GAM → Kevel segment ID translation table |
| `segmentMap.js` | Loads `segmentMap.csv` into a `Map` at runtime |
| `normalizeTargeting.js` | Renames `@_type` → `xsi_type` on exported GAM nodes so they can be fed into `gamZerkelMapper.js` |
| `normalizeTargeting.test.js` | Unit tests for `normalizeTargeting.js` |
| `geoTargetMap.js` | Static lookup: GAM criteriaId → Kevel `CountryCode`/`Region` fields (219 countries + state-level for US, DE, NL, GB, CA, AU) |
| `translateGeoTargeting.js` | Translates a raw exported `geoTargeting` node to Kevel-ready rule objects using `geoTargetMap.js` |
| `translateGeoTargeting.test.js` | Unit tests for `translateGeoTargeting.js` |
| `gamClient.js` | Shared GAM SOAP plumbing (auth, `soapCall`, paging) reused by the scripts below |
| `fetchTargetingMaps.js` | Fetches GAM key/value name↔id maps via the GAM API |
| `exportData.js` | Full raw export of core GAM entities for migration |
| `.env.example` | Template for the GAM API config used by the GAM scripts |

## Fetching the key/value maps from GAM

`translateCustomTargeting` needs `keys` and `values` lookup maps because GAM
leaves reference targeting by **ID**, not name. `fetchTargetingMaps.js` pulls
those maps from GAM's `CustomTargetingService` and writes them as
`targetingMaps.json` in exactly the shape the mapper consumes:

```json
{
  "keys":   { "101": "category", "102": "user_type" },
  "values": { "201": "mens_shoes", "202": "running_shoes" }
}
```

> The maps use each entry's GAM **`name`** field (the value matched at ad-request
> time), not its human-facing `displayName`.

### Setup

1. Create a Google **service account** and download its JSON key.
2. Add the service account as an API user in GAM
   (*Admin → Global settings → API access*).
3. Copy `.env.example` → `.env` and fill in your values:

   | Variable | Required | Notes |
   |---|---|---|
   | `GAM_NETWORK_CODE` | yes | Your GAM network code |
   | `GAM_SERVICE_ACCOUNT_KEY_FILE` | yes | Path to the service-account JSON key |
   | `GAM_APPLICATION_NAME` | no | Arbitrary app name string |
   | `GAM_API_VERSION` | no | A currently-supported GAM API version (e.g. `v202508`) |

4. Install dependencies: `npm install`

### Run

```bash
node fetchTargetingMaps.js [outputFile]   # default: ./targetingMaps.json
# or
npm run fetch-maps
```

The script mints an OAuth2 token (scope `dfp`) from the service account, pages
through all custom targeting keys, then pages through their values (GAM requires
value queries to filter by `customTargetingKeyId`, which the script batches
automatically).

### End-to-end

```js
const { translateCustomTargeting } = require('./gamZerkelMapper');
const { keys, values } = require('./targetingMaps.json');

const zerkel = translateCustomTargeting(gamLineItem.targeting.customTargeting, keys, values);
```

## Full data export

`exportData.js` produces a raw snapshot of the campaign hierarchy you need to
migrate off GAM. It pages through each entity's SOAP service and writes one JSON
file per entity into an `export/` directory, plus a `manifest.json`:

| File | GAM service | Contents |
|---|---|---|
| `companies.json` | `CompanyService` | Advertisers + agencies |
| `orders.json` | `OrderService` | Orders (GAM's "campaigns") |
| `lineItems.json` | `LineItemService` | Line items (incl. full raw targeting) |
| `creatives.json` | `CreativeService` | Creatives (polymorphic) |
| `lineItemCreativeAssociations.json` | `LineItemCreativeAssociationService` | Line-item ↔ creative links |
| `manifest.json` | — | Timestamp, network code, API version, per-entity counts/errors |

Setup and credentials are identical to the fetch script (same `.env` / service
account — see below). Then:

```bash
node exportData.js [outDir]   # default: ./export
# or
npm run export
```

Notes:

- **Raw fidelity.** Objects are dumped exactly as GAM returns them. Polymorphic
  types (e.g. `ImageCreative` vs `ThirdPartyCreative`, `CustomCriteriaSet` vs
  `CustomCriteria`) carry their discriminator in the **`@_type`** property
  (from the SOAP `xsi:type` attribute).
- **Not directly mapper-ready.** Because the discriminator is `@_type` (not
  `xsi_type`), exported `lineItems.json` targeting can't be fed straight into
  `gamZerkelMapper.js` — it expects `xsi_type`. A small normalization step would
  bridge them; translation is intentionally kept out of the export.
- **Full export, all statuses.** No status filter is applied — archived/paused/
  completed orders and line items are included (correct for a migration snapshot).
- **Partial progress survives failures.** Each entity is written as it
  completes, and a failure on one entity is recorded in `manifest.json` while the
  run continues to the next. Large networks (thousands of creatives/line items)
  can take several minutes; paging is sequential to stay within GAM's QPS limits.

## Bridging the export to the mapper

`exportData.js` and `gamZerkelMapper.js` cannot be wired together directly.
The exporter uses `fast-xml-parser` with `attributeNamePrefix: '@_'`, so
polymorphic GAM objects (e.g. `CustomCriteriaSet`) carry their type
discriminator as `@_type`. The mapper expects `xsi_type`.

`normalizeTargeting.js` bridges this with a single recursive rename:

```js
const { normalizeTargeting } = require('./normalizeTargeting');
const { translateCustomTargeting } = require('./gamZerkelMapper');
const { keys, values } = require('./targetingMaps.json');

const rawNode = lineItem.targeting.customTargeting;
const zerkel = translateCustomTargeting(normalizeTargeting(rawNode), keys, values);
```

**Assumption:** the only `@_type` values within `customTargeting` are
`CustomCriteriaSet` and `CustomCriteria`. If other types appear (e.g.
`AudienceSegmentCriteria`), the mapper will throw `Unrecognized xsi_type: ...`.
This has not been verified against a real Booking.com export — treat any such
throw as a signal to extend the mapper rather than the normalizer.

## Segment targeting

GAM `AudienceSegmentCriteria` nodes cannot be translated automatically.
Segment IDs are account-specific and require a human mapping exercise:
Booking.com identifies which GAM segments correspond to which Kevel segments
and populates `segmentMap.csv`.

`segmentMap.js` loads that CSV at runtime and passes the resulting Map into
`translateCustomTargeting` as the optional fourth argument:

```js
const { loadSegmentMap } = require('./segmentMap');
const { translateCustomTargeting } = require('./gamZerkelMapper');
const path = require('path');

const segmentMap = loadSegmentMap(path.join(__dirname, 'segmentMap.csv'));
const { zerkel, unsupported } = translateCustomTargeting(
  normalizeTargeting(lineItem.targeting.customTargeting),
  keys,
  values,
  segmentMap
);

// zerkel: full Zerkel string including any mapped segments
// unsupported: segment nodes with IDs not found in segmentMap.csv
```

**If `segmentMap` is omitted or a segment ID is missing**, the segment node
contributes nothing to the Zerkel output and is recorded in `unsupported`
rather than throwing. The rest of the tree translates normally.

**To populate `segmentMap.csv`:** copy the dummy file and fill in the real
GAM and Kevel segment IDs. The `description` column is for reference only.

## Geo targeting

GAM `Location` objects carry only a numeric `id` (criteriaId), a `type` string,
a `canonicalParentId`, and a `displayName`. There are no country code or region
code fields. `geoTargetMap.js` is a static lookup table (sourced from Google's
geo targets CSV 2026-05-28, cross-referenced with the Kevel /v1/countries API)
that maps criteriaIds to Kevel `CountryCode` and `Region` fields.

`translateGeoTargeting.js` uses the map to translate a raw exported `geoTargeting`
node into Kevel-ready rule objects:

```js
const { translateGeoTargeting } = require('./translateGeoTargeting');

const { rules, unsupported } = translateGeoTargeting(
  lineItem.targeting.geoTargeting
);

// rules: array of objects ready to POST to /v1/flight/{id}/geotargeting
//        (caller adds FlightId before POSTing)
// unsupported: locations not in the map (cities, postal codes, DMA regions, etc.)
```

**Coverage (v1):**
- All 219 active countries
- State/province-level regions for: US (51), DE (16), NL (12), GB (4), CA (13), AU (8)
- Everything else (cities, postal codes, counties, DMA regions) → `unsupported` array

**DMA regions (`DMA_REGION` type) are not supported.** GAM DMA criteriaIds are
Nielsen-proprietary and absent from Google's public geo CSV. They will appear in
the `unsupported` array.

## API

```js
const { translateCustomTargeting, collectIds } = require('./gamZerkelMapper');
```

### `translateCustomTargeting(node, keys, values[, segmentMap]) → { zerkel, unsupported }`

Recursively translates a GAM `customTargeting` node into a Kevel
`CustomTargeting` expression.

- `node` — a GAM `CustomCriteriaSet`, `CustomCriteria`, or `AudienceSegmentCriteria` object
- `keys` — map of `String(keyId)` → key name, e.g. `{ "101": "category" }`
- `values` — map of `String(valueId)` → value, e.g. `{ "201": "mens_shoes" }`
- `segmentMap` *(optional)* — `Map<number,number>` of GAM→Kevel segment IDs; unmapped segments go to `unsupported`

Returns `{ zerkel, unsupported }` where `zerkel` is the Zerkel string (same
format as before) and `unsupported` is an array of `AudienceSegmentCriteria`
nodes whose IDs had no mapping.

```js
const { zerkel, unsupported } = translateCustomTargeting(
  { xsi_type: 'CustomCriteria', keyId: 101, operator: 'IS', valueIds: [201] },
  { '101': 'category' },
  { '201': 'mens_shoes' }
);
// zerkel => "\"category contains \\\"mens_shoes\\\"\""
// unsupported => []
```

### `collectIds(node) → { keyIds, valueIds, segmentIds }`

Walks the tree and returns every unique `keyId`, `valueId`, and `segmentId` (sorted). Use it
to batch your GAM `CustomTargetingService` lookups *before* translating.

```js
collectIds(node);
// => { keyIds: [101, 102, 103], valueIds: [201, 202, 301, 401], segmentIds: [] }
```

## Translation rules

| GAM | Zerkel |
|---|---|
| `CustomCriteriaSet(OR)` | children joined with ` or ` |
| `CustomCriteriaSet(AND)` | children joined with ` and ` |
| `CustomCriteria` `IS` + 1 value | `key contains "value"` |
| `CustomCriteria` `IS` + N values | `(key contains "v1" or key contains "v2")` |
| `CustomCriteria` `IS_NOT` + 1 value | `not (key contains "value")` |
| `CustomCriteria` `IS_NOT` + N values | `not (key contains "v1" or key contains "v2")` |

### Parenthesization

- A multi-child set at the **root** (depth 0) is joined without outer parens.
- A set nested inside another set (depth > 0) is wrapped in `(...)`.
- `IS_NOT` always wraps its inner expression in `not (...)`.

## Edge cases

| Situation | Behavior |
|---|---|
| Missing `keyId` / `valueId` in lookup | Emits placeholder `unknown_key_<id>` / `unknown_value_<id>` (no crash) |
| Key name contains hyphens | Normalized to underscores (`page-type` → `page_type`) |
| Empty `valueIds` / empty `children` | Skipped; an empty tree yields `""` |
| Unrecognized `xsi_type` or `operator` | Throws an `Error` |
| `node` is `null` / not an object | Returns `""` |

## Migration caveats

Beyond boolean logic (which maps cleanly), watch for:

1. **Expression length** — Zerkel strings have a length limit; very large GAM
   criteria sets may need chunking.
2. **Key name compatibility** — unsupported characters (e.g. hyphens) are
   normalized here; confirm names match your Kevel keys.
3. **Case sensitivity** — Kevel matching is case-sensitive. Keep GAM casing
   consistent between targeting rules and request-time properties.
4. **Non-KV GAM targeting** — audience segments, CMS metadata, etc. are **not**
   plain key-values and are out of scope; they map to Kevel only if an
   equivalent request property / UserDB segment / reserved key exists.
5. **Export → mapper gap** — exported `lineItems.json` uses `@_type` as the
   discriminator, not `xsi_type`. Always pass `customTargeting` nodes through
   `normalizeTargeting()` before calling `translateCustomTargeting()`.
6. **Geo targeting coverage** — `geoTargetMap.js` covers countries and
   state-level regions for US, DE, NL, GB, CA, and AU. Other sub-country
   regions, cities, postal codes, and DMA regions go to `unsupported` and
   require manual handling or map expansion.
7. **Segment targeting** — `AudienceSegmentCriteria` nodes require a manual
   mapping in `segmentMap.csv`. Unmapped segments are skipped (not thrown)
   and recorded in the `unsupported` array of the translation result.
   The dummy `segmentMap.csv` must be replaced with real mappings before
   running against production line items.

## Usage

```bash
npm install          # install deps (needed for fetchTargetingMaps.js)

node gamZerkelMapper.js   # run the built-in mapper demo
node --test               # run the test suite (Node 18+)
node --test normalizeTargeting.test.js   # run normalize tests
npm test                              # run all tests (mapper + normalize + geo)
node --test translateGeoTargeting.test.js   # run geo targeting tests
npm run fetch-maps        # fetch key/value maps from GAM (needs .env)
npm run export            # full raw entity export to export/ (needs .env)
```
