// Provider model lists, cached on disk and refreshed daily.
// Step 3 uses it to know each model's kind (image / video / audio).
// Step 4 turns it into the studio's model picker (fields, prices, merging).
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS, providerById } from '../providers/index.js';

const DAY = 86_400_000;
const KIND_APIMART = { image: 'image', video: 'video', audio: 'audio' };
const KIND_ATLAS = { Image: 'image', Video: 'video', Audio: 'audio' };

export function createCatalog({ dataDir, providers, log }) {
  const dir = path.join(dataDir, 'catalog');
  fs.mkdirSync(dir, { recursive: true });
  const state = {}; // providerId -> { fetchedAt, models: Map(id -> { id, kind, raw }) }

  function normalize(providerId, list) {
    const models = new Map();
    for (const raw of list) {
      if (providerId === 'apimart') {
        const kind = KIND_APIMART[raw.category];
        if (kind) models.set(raw.id, { id: raw.id, kind, raw });
      } else if (providerId === 'atlas') {
        const kind = KIND_ATLAS[raw.type];
        if (kind) models.set(raw.model, { id: raw.model, kind, raw });
      }
    }
    return models;
  }

  function loadFromDisk(providerId) {
    const file = path.join(dir, `${providerId}-models.json`);
    if (!fs.existsSync(file)) return;
    try {
      const { fetchedAt, list } = JSON.parse(fs.readFileSync(file, 'utf8'));
      state[providerId] = { fetchedAt, models: normalize(providerId, list) };
    } catch (error) {
      log?.warn({ err: error }, `catalog: cannot read ${file}`);
    }
  }

  async function refresh(providerId) {
    const provider = providerById(providerId);
    const cfg = providers.resolve(providerId);
    if (!cfg.enabled) return;
    if (providerId === 'apimart' && !cfg.apiKey) return; // APIMart lists models only with a key
    const list = await provider.listModels(cfg);
    const fetchedAt = Date.now();
    fs.writeFileSync(path.join(dir, `${providerId}-models.json`), JSON.stringify({ fetchedAt, list }));
    state[providerId] = { fetchedAt, models: normalize(providerId, list) };
    log?.info(`catalog: ${providerId} — ${state[providerId].models.size} media models`);
  }

  async function refreshAll({ force = false } = {}) {
    for (const p of PROVIDERS) {
      const s = state[p.id];
      if (!force && s && Date.now() - s.fetchedAt < DAY) continue;
      try { await refresh(p.id); } catch (error) { log?.warn(`catalog: ${p.id} refresh failed — ${error.message}`); }
    }
  }

  PROVIDERS.forEach((p) => loadFromDisk(p.id));

  return {
    refreshAll,
    model(providerId, modelId) { return state[providerId]?.models.get(modelId) || null; },
    models(providerId) { return [...(state[providerId]?.models.values() || [])]; },
    fetchedAt(providerId) { return state[providerId]?.fetchedAt || null; },
  };
}
