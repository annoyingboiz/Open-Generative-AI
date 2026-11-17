// Provider catalogs → the studio's model picker.
// Refreshed on start (if older than a day), daily, and on demand by an admin.
//   DATA_DIR/catalog/<provider>-models.json   raw model lists
//   DATA_DIR/catalog/atlas-schemas/*.json     Atlas per-model field schemas
//   DATA_DIR/catalog/apimart-prices.json      APIMart prices per model
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PROVIDERS, providerById } from '../providers/index.js';
import { buildAtlasVariant, buildApimartVariants, buildStudioLists, apimartPrice, STUDIO_MODES } from './build.js';

const require = createRequire(import.meta.url);
const APIMART_OVERRIDES = require('./apimart-overrides.json');
const DAY = 86_400_000;
const KIND_APIMART = { image: 'image', video: 'video', audio: 'audio' };
const KIND_ATLAS = { Image: 'image', Video: 'video', Audio: 'audio' };

async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const index = i++;
      try { results[index] = await fn(items[index]); } catch { results[index] = null; }
    }
  }));
  return results;
}

export function createCatalog({ dataDir, providers, log }) {
  const dir = path.join(dataDir, 'catalog');
  const schemaDir = path.join(dir, 'atlas-schemas');
  fs.mkdirSync(schemaDir, { recursive: true });
  const raw = {}; // providerId -> { fetchedAt, list }
  let built = { variants: new Map(), lists: Object.fromEntries(STUDIO_MODES.map((m) => [m, []])), builtAt: 0, js: '' };
  let refreshing = null;

  const fileOf = (name) => path.join(dir, name);
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const schemaFile = (modelId) => path.join(schemaDir, `${modelId.replace(/[^a-z0-9.-]+/gi, '__')}.json`);

  function loadFromDisk() {
    for (const p of PROVIDERS) {
      const data = readJson(fileOf(`${p.id}-models.json`), null);
      if (data) raw[p.id] = data;
    }
  }

  function rebuild() {
    const variants = [];
    const enabled = (id) => providers.resolve(id).enabled && Boolean(providers.resolve(id).apiKey);
    if (raw.atlas && enabled('atlas')) {
      for (const entry of raw.atlas.list) {
        if (!['Image', 'Video'].includes(entry.type)) continue;
        const schema = readJson(schemaFile(entry.model), null);
        if (!schema) continue;
        const v = buildAtlasVariant(entry, schema);
        if (v) variants.push(v);
      }
    }
    if (raw.apimart && enabled('apimart')) {
      const prices = readJson(fileOf('apimart-prices.json'), {});
      for (const model of raw.apimart.list) {
        if (!['image', 'video'].includes(model.category)) continue;
        variants.push(...buildApimartVariants(model, APIMART_OVERRIDES[model.id], apimartPrice(prices[model.id])));
      }
    }
    const lists = buildStudioLists(variants);
    built = {
      variants: new Map(variants.map((v) => [v.key, v])),
      lists,
      builtAt: Date.now(),
      js: `window.__DZ_CATALOG__=${JSON.stringify({ builtAt: Date.now(), lists }).replace(/</g, '\\u003c')};\n`,
    };
    log?.info(`catalog: built ${variants.length} studio models (${STUDIO_MODES.map((m) => `${m} ${lists[m].length}`).join(', ')})`);
  }

  async function refreshProvider(providerId, { force }) {
    const provider = providerById(providerId);
    const cfg = providers.resolve(providerId);
    if (!cfg.enabled || !cfg.apiKey) return;
    const current = raw[providerId];
    if (!force && current && Date.now() - current.fetchedAt < DAY) return;
    const list = await provider.listModels(cfg);
    raw[providerId] = { fetchedAt: Date.now(), list };
    fs.writeFileSync(fileOf(`${providerId}-models.json`), JSON.stringify(raw[providerId]));

    if (providerId === 'atlas') {
      const media = list.filter((e) => ['Image', 'Video'].includes(e.type) && e.schema);
      const results = await mapLimit(media, 8, async (e) => {
        const schema = await provider.schema(cfg, e.schema);
        fs.writeFileSync(schemaFile(e.model), JSON.stringify(schema));
        return true;
      });
      log?.info(`catalog: atlas — ${list.length} models, ${results.filter(Boolean).length}/${media.length} schemas`);
    }
    if (providerId === 'apimart') {
      const media = list.filter((m) => ['image', 'video'].includes(m.category));
      const prices = {};
      await mapLimit(media, 6, async (m) => { prices[m.id] = await provider.price(cfg, m.id); });
      fs.writeFileSync(fileOf('apimart-prices.json'), JSON.stringify(prices));
      log?.info(`catalog: apimart — ${list.length} models, ${Object.values(prices).filter(Boolean).length}/${media.length} prices`);
    }
  }

  async function refreshAll({ force = false } = {}) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      for (const p of PROVIDERS) {
        try { await refreshProvider(p.id, { force }); } catch (error) { log?.warn(`catalog: ${p.id} refresh failed — ${error.message}`); }
      }
      rebuild();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  loadFromDisk();
  rebuild();

  return {
    refreshAll,
    rebuild,
    // Model kind lookup for direct calls (/api/v1/p/<provider>/<model>).
    model(providerId, modelId) {
      const entry = raw[providerId]?.list?.find((m) => (providerId === 'atlas' ? m.model : m.id) === modelId);
      if (!entry) return null;
      const kind = providerId === 'atlas' ? KIND_ATLAS[entry.type] : KIND_APIMART[entry.category];
      return kind ? { id: modelId, kind } : null;
    },
    variant(key) { return built.variants.get(key) || null; },
    clientScript() { return built.js; },
    stats() {
      return {
        builtAt: built.builtAt,
        models: built.variants.size,
        lists: Object.fromEntries(Object.entries(built.lists).map(([k, v]) => [k, v.length])),
        fetchedAt: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.fetchedAt])),
      };
    },
  };
}
