// Builds the studio model lists from provider catalogs.
// Each "variant" = one provider model in one studio mode (t2i, i2i, t2v, i2v, v2v).
//   variant.model  — entry in the studio's models.js format (sent to the browser)
//   variant.server — how to call the provider (never sent to the browser)
import { familyFor, atlasParts, prettyFamilyName, stripModeWords } from './families.js';
import { studioFieldsFromSchema, HIDDEN_FIELDS } from './schema.js';

export const STUDIO_MODES = ['t2i', 'i2i', 't2v', 'i2v', 'v2v'];
const KIND_OF_MODE = { t2i: 'image', i2i: 'image', t2v: 'video', i2v: 'video', v2v: 'video' };
const MODE_SUFFIX = { t2i: 'text-to-image', i2i: 'image-to-image', t2v: 'text-to-video', i2v: 'image-to-video', v2v: 'video-to-video' };
const PROVIDER_NAME = { apimart: 'APIMart', atlas: 'Atlas' };

// Vendor → logo key used by the studio (providerLogos.js) and a display name.
const VENDORS = {
  google: ['google', 'Google'], kwaivgi: ['kling', 'Kling'], kling: ['kling', 'Kling'], bytedance: ['bytedance', 'ByteDance'],
  openai: ['openai', 'OpenAI'], 'black-forest-labs': ['black-forest-labs', 'Black Forest Labs'], minimax: ['minimax', 'MiniMax'],
  alibaba: ['alibaba', 'Alibaba'], xai: ['xai', 'xAI'], midjourney: ['midjourney', 'Midjourney'], vidu: ['vidu', 'Vidu'],
  pixverse: ['pixverse', 'PixVerse'], tencent: ['tencent', 'Tencent'], luma: ['luma', 'Luma'], runway: ['runway', 'Runway'],
};
function vendorOf(id) {
  const s = id.toLowerCase();
  if (VENDORS[s]) return VENDORS[s];
  if (/gemini|nano-banana|veo|imagen/.test(s)) return VENDORS.google;
  if (/kling/.test(s)) return VENDORS.kling;
  if (/seedance|seedream/.test(s)) return VENDORS.bytedance;
  if (/gpt|dall-e|sora/.test(s)) return VENDORS.openai;
  if (/flux/.test(s)) return VENDORS['black-forest-labs'];
  if (/minimax|hailuo/.test(s)) return VENDORS.minimax;
  if (/wan|qwen|happyhorse/.test(s)) return VENDORS.alibaba;
  if (/grok/.test(s)) return VENDORS.xai;
  if (/vidu/.test(s)) return VENDORS.vidu;
  if (/pixverse/.test(s)) return VENDORS.pixverse;
  if (/hunyuan|^hy-/.test(s)) return VENDORS.tencent;
  if (/midjourney/.test(s)) return VENDORS.midjourney;
  return [s.split(/[-/]/)[0], s.split(/[-/]/)[0]];
}

export function priceLabel(price) {
  if (!price || !Number.isFinite(price.usd)) return '';
  const fmt = (v) => (v >= 0.1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4)).replace(/0+$/, '').replace(/\.$/, '');
  const values = price.byResolution ? Object.values(price.byResolution).filter(Number.isFinite) : [];
  const lo = values.length ? Math.min(...values) : price.usd;
  const hi = values.length ? Math.max(...values) : price.usd;
  const amount = lo === hi ? `$${fmt(lo)}` : `$${fmt(lo)}–${fmt(hi)}`;
  return price.unit === 'second' ? `${amount}/s` : amount;
}

function studioModel({ provider, mode, slug, endpoint, family, familyName, vendorId, fields, price, description, cover, basic }) {
  const [vendorKey, vendorName] = vendorOf(vendorId);
  const label = priceLabel(price);
  return {
    id: `dz-${provider}-${slug}-${MODE_SUFFIX[mode]}`,
    name: [familyName, PROVIDER_NAME[provider], label, basic ? 'basic' : ''].filter(Boolean).join(' · '),
    endpoint,
    provider: vendorKey,
    provider_name: vendorName,
    description: description || undefined,
    image_url: cover || undefined,
    dzFamily: `dz-${family}`,
    dzFamilyName: familyName,
    dzProvider: provider,
    dzProviderName: PROVIDER_NAME[provider],
    dzPrice: price ? { ...price, label } : null,
    dzBasic: basic || undefined,
    ...fields,
  };
}

// ── Atlas ─────────────────────────────────────────────────────────────────

const ATLAS_MODE = { 'TEXT-TO-IMAGE': 't2i', 'IMAGE-TO-IMAGE': 'i2i', 'TEXT-TO-VIDEO': 't2v', 'IMAGE-TO-VIDEO': 'i2v', 'VIDEO-TO-VIDEO': 'v2v' };

export function atlasPrice(entry) {
  const actual = entry?.price?.actual;
  const usd = Number(actual?.base_price);
  if (!Number.isFinite(usd)) return null;
  const unit = actual.unit === 'second' ? 'second' : entry.type === 'Image' ? 'image' : (actual.unit || 'request');
  return { usd, unit };
}

export function buildAtlasVariant(entry, schemaDoc) {
  const mode = (entry.categories || []).map((c) => ATLAS_MODE[c]).find(Boolean);
  if (!mode) return null;
  const input = schemaDoc?.components?.schemas?.Input;
  if (!input?.properties) return null;
  const props = input.properties;
  const renames = {};
  if (props.ratio && !props.aspect_ratio) renames.ratio = 'aspect_ratio';
  const fields = studioFieldsFromSchema(props, input.required || [], { renames });
  if (!fields) return null;
  if ((mode === 'i2i' || mode === 'i2v') && !fields.imageField) return null;
  if (mode === 'v2v' && !fields.videoField) return null;

  const { vendor, base, variant } = atlasParts(entry.model);
  const family = familyFor('atlas', entry.model);
  const familyName = stripModeWords(entry.displayName) || prettyFamilyName(family);
  const price = atlasPrice(entry);
  const modeSlug = mode === 'i2v' && /reference/.test(entry.model) ? 'reference' : mode === 'v2v' ? atlasParts(entry.model).mode : '';
  const slug = [vendor, base, variant, modeSlug].filter(Boolean).join('-').replace(/[^a-z0-9.]+/gi, '-').toLowerCase();
  const endpoint = `p/atlas/${entry.model}`;
  const allowed = Object.keys(props).filter((k) => !HIDDEN_FIELDS.has(k) || k === 'model');
  const toProvider = Object.fromEntries(Object.entries(renames).map(([from, to]) => [to, from]));
  return {
    key: endpoint,
    provider: 'atlas',
    providerModel: entry.model,
    mode,
    kind: KIND_OF_MODE[mode],
    family,
    model: studioModel({
      provider: 'atlas', mode, slug, endpoint, family, familyName, vendorId: vendor, fields, price,
      description: entry.profile ? String(entry.profile).slice(0, 300) : undefined,
      cover: entry.coverUrl || entry.avatar || undefined,
    }),
    server: { rename: toProvider, allowed, fixed: {}, price },
  };
}

// ── APIMart ───────────────────────────────────────────────────────────────

const APIMART_TAG_MODE = { 'Text to Image': 't2i', 'Image to Image': 'i2i', 'Text to Video': 't2v', 'Image to Video': 'i2v', 'Video to Video': 'v2v' };

export function apimartPrice(p) {
  if (!p) return null;
  const perSecond = p.billing_type === 'per_second';
  const byResolution = p.resolution_paid_prices
    ? Object.fromEntries(Object.entries(p.resolution_paid_prices).filter(([k]) => !/input/i.test(k)).map(([k, v]) => [k.toLowerCase(), Number(v)]))
    : null;
  const usd = Number(p.paid_price);
  if (!Number.isFinite(usd)) return null;
  return { usd, unit: perSecond ? 'second' : (p.billing_type === 'per_image' || !perSecond ? 'image' : 'request'), byResolution: byResolution && Object.keys(byResolution).length ? byResolution : undefined };
}

// Basic fields when the model has no curated description (APIMart's own
// schema has no allowed values).
function apimartBasicFields(model, mode) {
  const props = model.parameters?.input_schema?.properties || {};
  const inputs = {};
  const fields = { hasPrompt: true, promptRequired: mode === 't2i' || mode === 't2v' };
  if (mode === 'i2i' || mode === 'i2v') {
    inputs.image_urls = { name: 'image_urls', title: 'Images', type: 'array', field: 'image', items: { type: 'string' } };
    fields.imageField = 'image_urls';
    fields.maxImages = mode === 'i2v' ? 2 : 4;
  }
  if (mode === 'v2v' && props.video_urls) {
    inputs.video_urls = { name: 'video_urls', title: 'Videos', type: 'array', field: 'video', items: { type: 'string' } };
    fields.videoField = 'video_urls';
    fields.maxVideos = 1;
  }
  return { inputs, ...fields, required: [] };
}

export function buildApimartVariants(model, override, price) {
  const tagModes = (model.capability_tags || []).map((t) => APIMART_TAG_MODE[t]).filter(Boolean);
  // Modes from APIMart's tags plus modes its docs describe (tags are sometimes
  // incomplete, e.g. Nano Banana Pro edits images but is tagged text-to-image).
  const modes = [...tagModes, ...Object.keys(override?.modes || {})];
  const family = override?.family || familyFor('apimart', model.id);
  const familyName = override?.name || prettyFamilyName(family);
  const out = [];
  for (const mode of [...new Set(modes)]) {
    if (!STUDIO_MODES.includes(mode)) continue;
    const spec = override?.modes?.[mode];
    let fields;
    if (spec) {
      const inputs = { ...(override.common?.inputs || {}), ...(spec.inputs || {}) };
      fields = { inputs, hasPrompt: spec.hasPrompt ?? true, promptRequired: spec.promptRequired ?? (mode === 't2i' || mode === 't2v'), required: spec.required || [] };
      for (const [k, v] of Object.entries(spec.media || {})) {
        if (k === 'image') { fields.imageField = v.field; fields.maxImages = v.max || 1; if (v.last) fields.lastImageField = v.last; }
        if (k === 'video') { fields.videoField = v.field; fields.maxVideos = v.max || 1; }
        if (k === 'audio') { fields.audioField = v.field; fields.maxAudios = v.max || 1; }
        inputs[v.field] = { name: v.field, title: v.title || k, type: (v.max || 1) > 1 || /s$/.test(v.field) ? 'array' : 'string', field: k, maxItems: v.max, items: { type: 'string' } };
        if (v.last) inputs[v.last] = { name: v.last, title: 'Last frame', type: 'string', field: k };
      }
    } else {
      fields = apimartBasicFields(model, mode);
    }
    const endpoint = `p/apimart/${model.id}?m=${mode}`;
    const kind = KIND_OF_MODE[mode];
    // Images: APIMart calls the aspect ratio "size".
    const rename = { ...(kind === 'image' ? { aspect_ratio: 'size' } : {}), ...(override?.rename || {}), ...(spec?.rename || {}) };
    out.push({
      key: endpoint,
      provider: 'apimart',
      providerModel: model.id,
      mode,
      kind,
      family,
      model: studioModel({
        provider: 'apimart', mode, slug: model.id.toLowerCase().replace(/[^a-z0-9.]+/g, '-'), endpoint, family, familyName,
        vendorId: override?.vendor || model.id, fields, price, basic: !spec,
        description: override?.description,
      }),
      server: {
        rename,
        allowed: null,
        // Generic fields the studio adds that this model gets under another name.
        drop: ['image_url', 'images_list', 'video_url', 'videos_list', 'video_files', 'audio_url', 'audios_list']
          .filter((f) => ![fields.imageField, fields.lastImageField, fields.videoField, fields.audioField].includes(f)),
        fixed: { ...(override?.fixed || {}), ...(spec?.fixed || {}) },
        price,
      },
    });
  }
  return out;
}

// ── Merge into studio lists ───────────────────────────────────────────────

// Within a family, the cheaper provider is listed last: the studio treats the
// last entry as the freshest and picks it by default.
function sortKey(v) {
  const p = v.server.price;
  const values = p?.byResolution ? Object.values(p.byResolution) : [];
  const usd = values.length ? Math.min(...values) : p?.usd;
  return Number.isFinite(usd) ? usd : 1e9;
}

export function buildStudioLists(variants) {
  const lists = Object.fromEntries(STUDIO_MODES.map((m) => [m, []]));
  const byFamilyMode = new Map();
  for (const v of variants) {
    const k = `${v.mode}\u0000${v.family}`;
    if (!byFamilyMode.has(k)) byFamilyMode.set(k, []);
    byFamilyMode.get(k).push(v);
  }
  // One display name per family, preferring Atlas's (it has proper display names).
  const familyNames = new Map();
  for (const v of variants) {
    const current = familyNames.get(v.family);
    if (!current || (v.provider === 'atlas' && current.provider !== 'atlas')) {
      familyNames.set(v.family, { name: v.model.dzFamilyName, provider: v.provider });
    }
  }
  for (const group of byFamilyMode.values()) {
    group.sort((a, b) => sortKey(b) - sortKey(a));
    for (const v of group) {
      const familyName = familyNames.get(v.family)?.name || v.model.dzFamilyName;
      v.model.dzFamilyName = familyName;
      v.model.name = [familyName, v.model.dzProviderName, v.model.dzPrice?.label, v.model.dzBasic ? 'basic' : ''].filter(Boolean).join(' · ');
      lists[v.mode].push(v.model);
    }
  }
  return lists;
}

// Translates the studio's request into the provider's request.
export function toProviderBody(variant, body) {
  const { rename = {}, allowed, fixed = {}, drop = [] } = variant.server;
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (value === undefined || value === null || value === '' || key === 'onRequestId' || key === '_modelId') continue;
    if (drop.includes(key)) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const target = rename[key] || key;
    if (allowed && !allowed.includes(target)) continue;
    out[target] = value;
  }
  return { ...out, ...fixed };
}

// Rough cost in USD for the history and monthly limits.
export function estimateCost(variant, body) {
  const p = variant.server.price;
  if (!p) return null;
  const res = String(body?.resolution || '').toLowerCase();
  const unitPrice = (p.byResolution && (p.byResolution[res] ?? p.byResolution[res.replace(/p$/, 'p')])) ?? p.usd;
  if (p.unit === 'second') return unitPrice * (Number(body?.duration) || 5);
  const n = Number(body?.n || body?.num_images || 1) || 1;
  return unitPrice * n;
}
