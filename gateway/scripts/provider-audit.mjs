// Provider audit: what each provider's API takes for a model vs what Studio offers.
//
//   node scripts/provider-audit.mjs <DATA_DIR>/catalog > audit.json
//
// Reads the cached catalog (atlas-models.json, atlas-schemas/, apimart-models.json,
// apimart-prices.json, apimart-live.json); calls nothing. For every video model sold by
// two or more providers it prints:
//   studio: per provider, each endpoint Studio would call and the media roles it takes
//           (the same code the studio runs: dzCreate.js createEntries / mediaOf);
//   atlas:  per Atlas endpoint, the raw schema fields (name, type, item shape, limits, required).
// APIMart's raw side is in its docs (compared separately).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAtlasVariant, buildApimartVariants, buildStudioLists, apimartPrice } from '../src/catalog/build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) { console.error('usage: provider-audit.mjs <catalog dir>'); process.exit(2); }
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return fallback; } };
const schemaFile = (id) => path.join(dir, 'atlas-schemas', `${id.replace(/[^a-z0-9.-]+/gi, '__')}.json`);

const OVERRIDES = JSON.parse(fs.readFileSync(path.join(here, '../src/catalog/apimart-overrides.json'), 'utf8'));
const MANUAL = JSON.parse(fs.readFileSync(path.join(here, '../src/catalog/apimart-manual.json'), 'utf8'));

const variants = [];
const atlasRaw = {};
const atlas = readJson('atlas-models.json', null);
for (const entry of atlas?.list || []) {
  if (entry.type !== 'Video') continue;
  let schema = null;
  try { schema = JSON.parse(fs.readFileSync(schemaFile(entry.model), 'utf8')); } catch { continue; }
  const v = buildAtlasVariant(entry, schema);
  if (v) variants.push(v);
  atlasRaw[entry.model] = { categories: entry.categories, tags: entry.tags, studio: Boolean(v), fields: rawFields(schema) };
}
const apimart = readJson('apimart-models.json', null);
const prices = readJson('apimart-prices.json', {});
const overrides = { ...OVERRIDES, ...readJson('apimart-live.json', {}), ...MANUAL };
for (const model of apimart?.list || []) {
  if (model.category !== 'video') continue;
  variants.push(...buildApimartVariants(model, overrides[model.id], apimartPrice(prices[model.id], overrides[model.id])));
}
const lists = buildStudioLists(variants, { recommended: [] });

// The studio's own logic (packages/studio/src/dzCreate.js), loaded as a module.
globalThis.window = { __DZ_CATALOG__: { lists } };
const tmp = path.join(os.tmpdir(), `dzCreate-${process.pid}.mjs`);
fs.copyFileSync(path.join(here, '../../packages/studio/src/dzCreate.js'), tmp);
const dz = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

const entries = dz.createEntries('video');
const byFamily = new Map();
for (const e of entries) (byFamily.get(e.family) || byFamily.set(e.family, []).get(e.family)).push(e);
const studio = {};
for (const [family, list] of byFamily) {
  if (new Set(list.map((e) => e.provider)).size < 2) continue;
  studio[family] = Object.fromEntries(list.map((e) => [e.provider, {
    name: e.familyName,
    price: e.priceLabel,
    variants: e.variants.map((v) => ({
      endpoint: v.model.endpoint,
      mode: v.mode,
      roles: Object.fromEntries(Object.entries(v.media).map(([r, m]) => [r, { field: m.field, max: m.max }])),
      ratio: (v.model.inputs.aspect_ratio || v.model.inputs.ratio || v.model.inputs.size)?.enum || null,
      vendor: v.model.dzVendorId || v.model.id || null,
    })),
  }]));
}
const families = new Set(Object.keys(studio));
const atlasOut = Object.fromEntries(Object.entries(atlasRaw).filter(([id]) => [...families].some((f) => id.toLowerCase().replace(/[^a-z0-9]/g, '').includes(f.replace(/[^a-z0-9]/g, '')))));

process.stdout.write(JSON.stringify({ studio, atlas: atlasOut }, null, 1));

function rawFields(doc) {
  let props = null; let required = [];
  (function walk(o) {
    if (props || !o || typeof o !== 'object') return;
    if (o.properties && o.properties.prompt) { props = o.properties; required = o.required || []; return; }
    for (const v of Object.values(o)) walk(v);
  })(doc);
  if (!props) return null;
  const out = {};
  for (const [name, p] of Object.entries(props)) {
    if (['model', 'prompt', 'seed', 'negative_prompt'].includes(name)) continue;
    out[name] = {
      type: p.type,
      ...(p.items ? { items: p.items.type === 'object' ? Object.keys(p.items.properties || {}) : p.items.type } : {}),
      ...(p.maxItems ? { max: p.maxItems } : {}),
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(required.includes(name) ? { required: true } : {}),
      ...(p.description ? { about: String(p.description).slice(0, 220) } : {}),
    };
  }
  return out;
}
