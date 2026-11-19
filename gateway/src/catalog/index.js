// Provider catalogs → the studio's model picker.
// Refreshed on start (if older than a day), daily, and on demand by an admin.
//   DATA_DIR/catalog/<provider>-models.json   raw model lists
//   DATA_DIR/catalog/atlas-schemas/*.json     Atlas per-model field schemas
//   DATA_DIR/catalog/apimart-prices.json      APIMart prices per model
import { lookForClient } from '../look.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { providerFetch } from '../providers/http.js';
import { assertPublicHttpsUrl } from '../net-guard.js';
import { byteLimit } from '../storage.js';
import { PROVIDERS, providerById } from '../providers/index.js';
import { FAL_UPSCALE } from '../providers/fal-tools.js';
import { videoUpscaleSpec } from '../video-upscale.js';
import { buildAtlasVariant, buildApimartVariants, buildLocalVariants, buildElevenlabsVariants, buildStudioLists, apimartPrice, STUDIO_MODES, ELEVEN_STS_MODEL } from './build.js';
import { ELEVEN_TOOLS } from '../providers/elevenlabs.js';
import { LOCAL_MODELS } from '../providers/local.js';
import { fetchApimartDocs, buildApimartOverrides } from './apimart-docs.js';

const require = createRequire(import.meta.url);
const APIMART_OVERRIDES = require('./apimart-overrides.json');
// Hand-checked specs win over the bundled and the auto-parsed (live) ones.
const APIMART_MANUAL = Object.fromEntries(Object.entries(require('./apimart-manual.json')).filter(([k]) => !k.startsWith('_')));
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

export const DEFAULT_RECOMMENDED = Object.freeze([
  'dz-nano-banana-pro', 'dz-gpt-image-2.6-sunburst', 'dz-seedream-5-pro',
  'dz-kling-4', 'dz-seedance-2.5', 'dz-veo-3.1',
]);

function writeJsonAtomic(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

// Providers whose models only admins see and use: this server's GPU, and
// ElevenLabs on the owner's own account (his plan, his cloned voice).
export const ADMIN_ONLY = new Set(['local', 'elevenlabs']);

export function createCatalog({ dataDir, providers, log, getRecommended = () => DEFAULT_RECOMMENDED, changes = null, fetchDocs = fetchApimartDocs, localEnabled = () => false }) {
  const dir = path.join(dataDir, 'catalog');
  const schemaDir = path.join(dir, 'atlas-schemas');
  fs.mkdirSync(schemaDir, { recursive: true });
  const raw = {}; // providerId -> { fetchedAt, list }
  let built = { variants: new Map(), lists: Object.fromEntries(STUDIO_MODES.map((m) => [m, []])), builtAt: 0, listsJson: '{}', publicListsJson: '{}' };
  // Tools on fal.ai (upscaling): available as soon as fal has a key — checked
  // on every request, not at the end of a catalog refresh.
  const falEnabled = () => providers.resolve('fal').enabled && Boolean(providers.resolve('fal').apiKey);
  const keyed = (id) => { const c = providers.resolve(id); return Boolean(c.enabled && c.apiKey); };
  const currentTools = () => {
    const tools = falEnabled() ? { upscale: { provider: 'fal', ...FAL_UPSCALE } } : {};
    const video = videoUpscaleSpec(keyed); // models of providers that have a key
    if (video) tools.videoUpscale = video;
    return tools;
  };
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
        if (!['Image', 'Video', 'Audio'].includes(entry.type)) continue;
        const schema = readJson(schemaFile(entry.model), null);
        if (!schema) continue;
        const v = buildAtlasVariant(entry, schema);
        if (v) variants.push(v);
      }
    }
    if (raw.apimart && enabled('apimart')) {
      const prices = readJson(fileOf('apimart-prices.json'), {});
      // Specs from the bundled docs file, updated by the daily docs check.
      const overrides = { ...APIMART_OVERRIDES, ...(changes?.liveOverrides() || {}), ...APIMART_MANUAL };
      // Audio only with a hand-checked spec; some are our own names for one
      // APIMart model's other endpoints (Suno sound effects, Lyria in Flow Music).
      const ids = new Set(raw.apimart.list.map((m) => m.id));
      const virtual = Object.entries(APIMART_MANUAL).filter(([id, o]) => o.baseModel && ids.has(o.baseModel) && !ids.has(id)).map(([id, o]) => ({ id, category: 'audio', capability_tags: [], base: o.baseModel }));
      for (const model of [...raw.apimart.list, ...virtual]) {
        const audio = model.category === 'audio';
        if (!['image', 'video'].includes(model.category) && !(audio && APIMART_MANUAL[model.id])) continue;
        const override = audio ? APIMART_MANUAL[model.id] : overrides[model.id];
        variants.push(...buildApimartVariants(model, override, apimartPrice(prices[model.base || model.id], override)));
      }
    }
    // ElevenLabs on Denis's own account: his models and voices (admins only, like this server).
    if (raw.elevenlabs && enabled('elevenlabs')) {
      variants.push(...buildElevenlabsVariants(raw.elevenlabs.list, readJson(fileOf('elevenlabs-voices.json'), [])));
    }
    // This server's models (admins only: the lists for everyone else leave them out).
    if (localEnabled()) variants.push(...buildLocalVariants());
    const lists = buildStudioLists(variants, { recommended: getRecommended() || [] });
    const publicLists = Object.fromEntries(Object.entries(lists).map(([mode, list]) => [mode, list.filter((m) => !ADMIN_ONLY.has(m.dzProvider))]));
    built = {
      variants: new Map(variants.map((v) => [v.key, v])),
      lists,
      builtAt: Date.now(),
      listsJson: JSON.stringify(lists),
      publicListsJson: JSON.stringify(publicLists),
    };
    log?.info(`catalog: built ${variants.length} studio models (${STUDIO_MODES.map((m) => `${m} ${lists[m].length}`).join(', ')})`);
  }

  // A fresh list (< 1 day) is kept, but missing derived data (prices, schemas)
  // is always filled in — a restart mid-refresh must not leave gaps forever.
  async function refreshProvider(providerId, { force }) {
    const provider = providerById(providerId);
    const cfg = providers.resolve(providerId);
    if (!cfg.enabled || !cfg.apiKey) return;
    const current = raw[providerId];
    const fresh = !force && current && Date.now() - current.fetchedAt < DAY;
    let list = current?.list;
    if (!fresh) {
      list = await provider.listModels(cfg);
      raw[providerId] = { fetchedAt: Date.now(), list };
      writeJsonAtomic(fileOf(`${providerId}-models.json`), raw[providerId]);
    }

    if (providerId === 'atlas') {
      const media = list.filter((e) => ['Image', 'Video', 'Audio'].includes(e.type) && e.schema);
      const todo = fresh ? media.filter((e) => !fs.existsSync(schemaFile(e.model))) : media;
      if (!todo.length) return;
      const results = await mapLimit(todo, 8, async (e) => {
        const schema = await provider.schema(cfg, e.schema);
        writeJsonAtomic(schemaFile(e.model), schema);
        return true;
      });
      log?.info(`catalog: atlas — ${list.length} models, ${results.filter(Boolean).length}/${todo.length} schemas fetched`);
    }
    if (providerId === 'elevenlabs') {
      // Voices change when you clone or design one: fetched on every refresh, not once a day.
      if (fresh && !force && fs.existsSync(fileOf('elevenlabs-voices.json'))) return;
      const voices = await provider.voices(cfg);
      writeJsonAtomic(fileOf('elevenlabs-voices.json'), voices);
      log?.info(`catalog: elevenlabs — ${list.length} models, ${voices.length} voices`);
      return;
    }
    if (providerId === 'apimart') {
      // Fetch prices for the whole list when it is new, otherwise only for the
      // models still without one. A failed request keeps the previous price.
      const pricesFile = fileOf('apimart-prices.json');
      const saved = readJson(pricesFile, {}) || {};
      const media = list.filter((m) => ['image', 'video'].includes(m.category) || (m.category === 'audio' && APIMART_MANUAL[m.id]));
      const todo = fresh ? media.filter((m) => !saved[m.id]) : media;
      if (!todo.length) return;
      const fetched = {};
      await mapLimit(todo, 6, async (m) => { fetched[m.id] = await provider.price(cfg, m.id); });
      const prices = {};
      for (const m of media) prices[m.id] = fetched[m.id] || saved[m.id] || null;
      writeJsonAtomic(pricesFile, prices);
      log?.info(`catalog: apimart — ${list.length} models, ${Object.values(fetched).filter(Boolean).length}/${todo.length} prices fetched, ${Object.values(prices).filter(Boolean).length}/${media.length} known`);
    }
  }

  // One refresh at a time. A call that asks for more (force / docs) while one
  // runs is not dropped: it runs right after, with the combined flags.
  let queued = null;
  async function refreshAll({ force = false, docs = false } = {}) {
    if (refreshing) {
      if (!force && !docs) return refreshing;
      queued = { force: Boolean(queued?.force || force), docs: Boolean(queued?.docs || docs) };
      return refreshing.then(() => {
        const next = queued;
        queued = null;
        return next ? refreshAll(next) : undefined;
      });
    }
    refreshing = (async () => {
      const ok = [];
      for (const p of PROVIDERS) {
        try { await refreshProvider(p.id, { force }); ok.push(p.id); } catch (error) { log?.warn(`catalog: ${p.id} refresh failed — ${error.message}`); }
      }
      rebuild();
      // What changed since the last check, per provider that answered.
      if (changes) {
        for (const id of ok) {
          if (!isEnabled(id) || !raw[id]) continue;
          try {
            const own = [...built.variants.values()].filter((v) => v.provider === id);
            changes.catalogChecked(id, own, { params: id !== 'apimart' }); // APIMart params: see the docs check
          } catch (error) { log?.warn(`changes: ${id} — ${error.message}`); }
        }
      }
    })().finally(() => { refreshing = null; });
    // The docs crawl takes a while: it never holds up the catalog or a request.
    // An explicit check (docs: true) waits for it, so its caller knows it ran.
    const done = refreshing.then(() => checkApimartDocs({ force: docs }));
    if (docs) return done;
    done.catch(() => {});
    return refreshing;
  }

  const isEnabled = (id) => providers.resolve(id).enabled && Boolean(providers.resolve(id).apiKey);
  // An automatic rollback (provider refused a new spec) is published at once.
  changes?.setOnSpecsChanged(() => { if (!refreshing) rebuild(); });

  // APIMart's parameters come from its docs: re-read them once a day.
  let docsRunning = null;
  function checkApimartDocs({ force = false } = {}) {
    if (!changes || !isEnabled('apimart')) return Promise.resolve();
    if (docsRunning) return docsRunning;
    if (!force && Date.now() - changes.lastDocsCheck() < DAY) return Promise.resolve();
    docsRunning = (async () => {
      try {
        const cfg = providers.resolve('apimart');
        const before = JSON.stringify(changes.liveOverrides());
        const { docs, total, failed, invalid } = await fetchDocs({ fetchFn: (url) => providerFetch(url, { proxy: cfg.proxy, timeoutMs: 20_000, redirect: 'error' }) });
        changes.apimartDocsChecked(buildApimartOverrides(docs), APIMART_OVERRIDES, { total, failed, invalid });
        changes.setLastDocsCheck(Date.now());
        log?.info(`changes: APIMart docs checked — ${docs.length}/${total} pages, ${invalid || 0} without parameters`);
        // New specs went live: publish them (unless a refresh is about to).
        if (JSON.stringify(changes.liveOverrides()) !== before && !refreshing) rebuild();
      } catch (error) {
        log?.warn(`changes: APIMart docs check failed — ${error.message}`);
      } finally {
        docsRunning = null;
      }
    })();
    return docsRunning;
  }

  // Model cover images from Atlas, cached on disk (see /dz/thumb).
  const thumbDir = path.join(dir, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  const THUMB_HOST = /(^|\.)atlascloud\.ai$/i;
  async function thumbnail(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return null; }
    if (url.protocol !== 'https:' || !THUMB_HOST.test(url.hostname)) return null;
    const name = crypto.createHash('sha256').update(url.href).digest('hex');
    const metaFile = path.join(thumbDir, `${name}.json`);
    const file = path.join(thumbDir, name);
    if (fs.existsSync(metaFile) && fs.existsSync(file)) return { path: file, mime: readJson(metaFile, {}).mime || 'image/jpeg' };
    const cfg = providers.resolve('atlas');
    try {
      await assertPublicHttpsUrl(url.href, { viaProxy: Boolean(cfg.proxy) });
      const response = await providerFetch(url.href, { proxy: cfg.proxy, timeoutMs: 20_000, redirect: 'error' });
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!response.ok || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime) || Number(response.headers.get('content-length') || 0) > 5_000_000) return null;
      try {
        await pipeline(Readable.fromWeb(response.body), byteLimit(5_000_000), fs.createWriteStream(`${file}.part`));
        fs.renameSync(`${file}.part`, file);
      } finally {
        try { fs.unlinkSync(`${file}.part`); } catch { /* moved or never created */ }
      }
      fs.writeFileSync(metaFile, JSON.stringify({ mime, url: url.href }));
      return { path: file, mime };
    } catch (error) {
      log?.warn(`thumbnail ${url.hostname}: ${error.message}`);
      return null;
    }
  }

  loadFromDisk();
  rebuild();

  return {
    refreshAll,
    rebuild,
    // Rebuild after a settings change. While a refresh runs it rebuilds at the
    // end anyway (reading the new settings), so we leave it to that instead of
    // publishing a half-refreshed catalog — and don't make the request wait.
    requestRebuild() {
      if (!refreshing) rebuild();
    },
    // Model kind lookup for direct calls (/api/v1/p/<provider>/<model>).
    model(providerId, modelId) {
      if (providerId === 'local') return LOCAL_MODELS[modelId] && localEnabled() ? { id: modelId, kind: 'video' } : null;
      if (providerId === 'elevenlabs') {
        const ok = ELEVEN_TOOLS[modelId] ? (modelId !== 'voice-changer' || raw.elevenlabs?.list?.some((m) => m.model_id === ELEVEN_STS_MODEL)) : raw.elevenlabs?.list?.some((m) => m.model_id === modelId && m.can_do_text_to_speech !== false);
        return ok ? { id: modelId, kind: 'audio' } : null;
      }
      const entry = raw[providerId]?.list?.find((m) => (providerId === 'atlas' ? m.model : m.id) === modelId);
      // Our own names for other endpoints of an APIMart model (Suno sound effects…).
      if (!entry && providerId === 'apimart' && APIMART_MANUAL[modelId]?.baseModel) return { id: modelId, kind: 'audio' };
      if (!entry) return null;
      const kind = providerId === 'atlas' ? KIND_ATLAS[entry.type] : providerId === 'fal' ? entry.kind : KIND_APIMART[entry.category];
      return kind ? { id: modelId, kind } : null;
    },
    variant(key) { return built.variants.get(key) || null; },
    hasTool(id) { return Boolean(currentTools()[id]); },
    tools: currentTools,
    // Families for the "Recommended" editor in Settings: key, name, image/video.
    families() {
      const out = new Map();
      for (const v of built.variants.values()) {
        const kind = ['t2i', 'i2i'].includes(v.mode) ? 'image' : ['t2v', 'i2v', 'v2v'].includes(v.mode) ? 'video' : null;
        const key = v.model.dzFamily;
        if (!kind || !key) continue;
        if (!out.has(key)) out.set(key, { key, name: v.model.dzFamilyName || key, kind });
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    thumbnail,
    clientScript(user = null) {
      const lists = user?.role === 'admin' ? built.listsJson : built.publicListsJson;
      const json = `{"builtAt":${built.builtAt},"lists":${lists},"tools":${JSON.stringify(currentTools())},"look":${JSON.stringify(lookForClient())}}`;
      return `window.__DZ_CATALOG__=${json.replace(/</g, '\\u003c')};\n`;
    },
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
