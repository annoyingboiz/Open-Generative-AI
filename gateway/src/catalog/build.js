// Builds the studio model lists from provider catalogs.
// Each "variant" = one provider model in one studio mode (t2i, i2i, t2v, i2v, v2v).
//   variant.model  — entry in the studio's models.js format (sent to the browser)
//   variant.server — how to call the provider (never sent to the browser)
import { familyFor, atlasParts, prettyFamilyName, stripModeWords } from './families.js';
import { studioFieldsFromSchema, HIDDEN_FIELDS } from './schema.js';

// t2a: text → audio (speech, music) — Tools → Audio.
export const STUDIO_MODES = ['t2i', 'i2i', 't2v', 'i2v', 'v2v', 't2a'];
const KIND_OF_MODE = { t2i: 'image', i2i: 'image', t2v: 'video', i2v: 'video', v2v: 'video', t2a: 'audio' };
const MODE_SUFFIX = { t2i: 'text-to-image', i2i: 'image-to-image', t2v: 'text-to-video', i2v: 'image-to-video', v2v: 'video-to-video', t2a: 'text-to-audio' };
const PROVIDER_NAME = { apimart: 'APIMart', atlas: 'Atlas', local: 'This server', elevenlabs: 'ElevenLabs' };

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
  if (price.usd === 0 && !price.byResolution) return 'free';
  // Same format as the studio's price label: $0.70, $0.035, $0.008.
  const fmt = (v) => (v >= 0.1 ? v.toFixed(2) : (v >= 0.01 ? v.toFixed(3) : v.toFixed(4)).replace(/0+$/, '').replace(/\.$/, ''));
  const values = price.byResolution ? Object.values(price.byResolution).filter(Number.isFinite) : [];
  const lo = values.length ? Math.min(...values) : price.usd;
  const hi = values.length ? Math.max(...values) : price.usd;
  const amount = lo === hi ? `$${fmt(lo)}` : `$${fmt(lo)}–${fmt(hi)}`;
  const label = price.unit === 'second' ? `${amount}/s` : price.unit === 'minute' ? `${amount}/min` : price.unit === 'chars' ? `${amount}/${price.perChars >= 1000 ? `${price.perChars / 1000}k` : price.perChars} chars` : amount;
  return price.from ? `from ${label}` : label;
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

const ATLAS_MODE = { 'TEXT-TO-IMAGE': 't2i', 'IMAGE-TO-IMAGE': 'i2i', 'TEXT-TO-VIDEO': 't2v', 'IMAGE-TO-VIDEO': 'i2v', 'VIDEO-TO-VIDEO': 'v2v', 'TEXT-TO-SPEECH': 't2a', 'TEXT-TO-AUDIO': 't2a' };
// Audio models that don't make sound from text (transcription, lyrics as text, voice cloning ids).
const NOT_STUDIO_AUDIO = /(^|\/)(seed-asr|stt-|lyrics-generation)|custom-voice/i;

export function atlasPrice(entry) {
  const actual = entry?.price?.actual;
  const usd = Number(actual?.base_price);
  if (!Number.isFinite(usd)) return null;
  // Atlas lists some video prices without a unit. They are per second at the
  // lowest resolution (Seedance 2.5: $0.134 listed, a 5 s 720p clip with
  // audio cost $1.51), so we show them as "from $x/s" and estimate per second.
  if (!actual.unit && entry.type === 'Video') return { usd, unit: 'second', from: true };
  // Audio: per characters, per generation… — the exact price comes from Atlas before you run it.
  if (entry.type === 'Audio') {
    const per = /^(\d*)k?\s*characters?$/i.exec(String(actual.unit || '').trim());
    if (per) return { usd, unit: 'chars', perChars: /k/i.test(actual.unit) ? 1000 * (Number(per[1]) || 1) : Number(per[1]) || 1 };
    return { usd, unit: actual.unit || 'request', from: !actual.unit };
  }
  const unit = actual.unit === 'second' ? 'second' : entry.type === 'Image' ? 'image' : (actual.unit || 'request');
  return { usd, unit };
}

export function buildAtlasVariant(entry, schemaDoc) {
  const mode = (entry.categories || []).map((c) => ATLAS_MODE[c]).find(Boolean);
  if (!mode) return null;
  if (mode === 't2a' && NOT_STUDIO_AUDIO.test(entry.model)) return null;
  const input = schemaDoc?.components?.schemas?.Input;
  if (!input?.properties) return null;
  const props = input.properties;
  const renames = {};
  if (props.ratio && !props.aspect_ratio) renames.ratio = 'aspect_ratio';
  // Speech models call their text "text": in the studio it is the prompt box.
  if (mode === 't2a' && props.text && !props.prompt) renames.text = 'prompt';
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
      // Served through our server (/dz/thumb) so the browser never calls Atlas's CDN.
      cover: (entry.coverUrl || entry.avatar) ? `/dz/thumb?u=${encodeURIComponent(entry.coverUrl || entry.avatar)}` : undefined,
    }),
    // Logos from Atlas (organization avatar, model logo), also via /dz/thumb.
    // buildStudioLists shares them with the same family/vendor on other providers.
    logos: {
      // Atlas's organization avatars often 404; the model logo is the brand mark.
      vendor: (entry.logo || entry.avatar) ? `/dz/thumb?u=${encodeURIComponent(entry.logo || entry.avatar)}` : null,
      model: (entry.logo || entry.avatar) ? `/dz/thumb?u=${encodeURIComponent(entry.logo || entry.avatar)}` : null,
    },
    server: { rename: toProvider, allowed, fixed: {}, price },
  };
}

// ── APIMart ───────────────────────────────────────────────────────────────

const APIMART_TAG_MODE = { 'Text to Image': 't2i', 'Image to Image': 'i2i', 'Text to Video': 't2v', 'Image to Video': 'i2v', 'Video to Video': 'v2v' };

export function apimartPrice(p, override = null) {
  // Hand-set price (speech is billed per token: an estimate per characters).
  if (override?.price) return { ...override.price };
  // Audio: one price per action ("suno@music-v6", "flowmusic@generate").
  if (override?.priceAction) {
    const usd = Number(p?.action_paid_prices?.[override.priceAction]);
    return Number.isFinite(usd) ? { usd, unit: 'request' } : null;
  }
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
  // A hand-checked spec (apimart-manual.json) lists exactly the modes that work.
  const modes = override?.onlyModes ? Object.keys(override.modes || {}) : [...tagModes, ...Object.keys(override?.modes || {})];
  const family = override?.family || familyFor('apimart', model.id);
  // Priced by the length of an input video we can't see here: a lower bound only.
  if (override?.priceFrom && price) price = { ...price, from: true };
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
        // Audio specs are complete: nothing else goes to APIMart (e.g. Suno's
        // max_mode, which doubles the price the limit reserved).
        allowed: kind === 'audio' && spec ? [...new Set([...Object.keys(fields.inputs), ...(fields.hasPrompt ? [rename.prompt || 'prompt'] : [])].map((k) => rename[k] || k))] : null,
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

// ── This server (local ComfyUI through h3-bridge) ─────────────────────────
// Static: what the bridge runs. H3: start frame (FL2VA) or up to 9 references
// (Ref2VA, refs are <Picture N> in the prompt), sound on by default; Wan 2.2:
// text or start frame, silent. Free; "Turbo" = the speed LoRAs (4–8 steps).

const LOCAL = [
  {
    model: 'minimax-h3', family: 'minimax-h-3', familyName: 'MiniMax H3', vendor: 'minimax',
    description: 'MiniMax H3 on this server (2× RTX 3090). Free; one job at a time — waits while the machine is busy. 768p 8 s ≈ 30 min, Turbo is several times faster.',
    resolutions: ['480p', '576p', '720p', '768p'], durations: [3, 4, 5, 6, 8, 10], sound: true, refSyntax: 'PictureN',
    variants: [
      { id: 'minimax-h3-r2v', mode: 't2v', media: {} },
      { id: 'minimax-h3-i2v', mode: 'i2v', media: { image: { field: 'image', title: 'Start frame' } }, required: ['image'] },
      { id: 'minimax-h3-r2v', mode: 'i2v', media: { reference_images: { field: 'image', title: 'References', max: 9 } }, required: ['reference_images'] },
    ],
  },
  {
    model: 'wan-2.2', family: 'wan-2.2', familyName: 'Wan 2.2', vendor: 'alibaba',
    description: 'Wan 2.2 14B on this server. Free, silent; one job at a time — waits while the machine is busy.',
    resolutions: ['480p', '576p', '720p'], durations: [2, 3, 4, 5], sound: false,
    variants: [
      { id: 'wan-2.2', mode: 't2v', media: {} },
      { id: 'wan-2.2', mode: 'i2v', media: { image: { field: 'image', title: 'Start frame' } }, required: ['image'] },
    ],
  },
];

export function buildLocalVariants() {
  const out = [];
  const price = { usd: 0, unit: 'clip' };
  for (const m of LOCAL) {
    for (const v of m.variants) {
      const inputs = {
        prompt: { name: 'prompt', title: 'Prompt', type: 'string' },
        resolution: { name: 'resolution', title: 'Resolution', type: 'string', enum: m.resolutions, default: '720p' },
        duration: { name: 'duration', title: 'Duration', type: 'int', enum: m.durations, default: 5 },
        turbo: { name: 'turbo', title: 'Turbo (faster, slightly less detail)', type: 'boolean', default: true },
        ...(m.sound ? { generate_audio: { name: 'generate_audio', title: 'Sound', type: 'boolean', default: true } } : {}),
        seed: { name: 'seed', title: 'Seed', type: 'int', minValue: 0, maxValue: 2147483647, description: 'Empty: a new one each time' },
      };
      const fields = { inputs, hasPrompt: true, promptRequired: true, required: v.required || [] };
      for (const [name, media] of Object.entries(v.media)) {
        const array = (media.max || 1) > 1;
        inputs[name] = { name, title: media.title, type: array ? 'array' : 'string', field: media.field, ...(array ? { maxItems: media.max, items: { type: 'string' } } : {}) };
        if (array) fields.maxImages = media.max;
        else fields.imageField = name;
      }
      const endpoint = `p/local/${v.id}?m=${v.mode}`;
      const model = studioModel({
        provider: 'local', mode: v.mode, slug: `${v.id}${v.media.reference_images ? '-refs' : ''}`, endpoint, family: m.family,
        familyName: m.familyName, vendorId: m.vendor, fields, price, description: m.description,
      });
      if (m.refSyntax) model.dzRefSyntax = m.refSyntax;
      out.push({ key: endpoint, provider: 'local', providerModel: v.id, mode: v.mode, kind: 'video', family: m.family, model, server: { rename: {}, allowed: null, drop: [], fixed: {}, price } });
    }
  }
  return out;
}

// ── ElevenLabs on your own account ────────────────────────────────────────
// Speech models come from GET /v1/models (what your key can use), voices from
// GET /v2/voices (yours first). Prices are ElevenLabs' published API rates
// (elevenlabs.io/pricing/api, Nov 2026): on a plan they come out of its credits.
const ELEVEN_TTS = {
  eleven_v4: { family: '4-text-to-speech', name: 'ElevenLabs v4 Text-to-Speech', usd: 0.08, max: 10000 },
  eleven_v4_turbo: { family: '4-turbo-text-to-speech', name: 'ElevenLabs v4 Turbo Text-to-Speech', usd: 0.04 },
  eleven_v3: { family: '3-text-to-speech', name: 'ElevenLabs v3 Text-to-Speech', usd: 0.08, max: 5000, v3: true },
  eleven_multilingual_v2: { family: 'elevenlabs-multilingual-v2', name: 'ElevenLabs Multilingual v2', usd: 0.08, max: 10000 },
  eleven_flash_v2_5: { family: 'elevenlabs-flash-v2-5', name: 'ElevenLabs Flash v2.5', usd: 0.04, max: 40000 },
  eleven_flash_v2: { family: 'elevenlabs-flash-v2', name: 'ElevenLabs Flash v2 (English)', usd: 0.04, max: 30000 },
};
const OWN_VOICE = new Set(['cloned', 'generated', 'professional']);

function voiceInput(voices) {
  const list = [...voices].sort((a, b) => Number(OWN_VOICE.has(b.category)) - Number(OWN_VOICE.has(a.category)) || a.name.localeCompare(b.name));
  if (!list.length) return null;
  const labelOf = (v) => {
    if (OWN_VOICE.has(v.category)) return `${v.name} · your voice`;
    const bits = [v.labels?.accent, v.labels?.gender, v.labels?.age].filter((x) => typeof x === 'string' && x);
    return [v.name, ...bits].join(' · ').slice(0, 80);
  };
  return {
    name: 'voice_id', title: 'Voice', type: 'string',
    enum: list.map((v) => v.id),
    enumLabels: Object.fromEntries(list.map((v) => [v.id, labelOf(v)])),
    default: list[0].id,
    description: 'Your voices first (cloned, designed, professional), then the ElevenLabs ones.',
  };
}
const slider = (name, title, min, max, step, def, description) => ({ name, title, type: 'number', minValue: min, maxValue: max, step, default: def, description });

export function buildElevenlabsVariants(models = [], voices = []) {
  const out = [];
  const voice = voiceInput(voices);
  if (!voice) return out;
  const add = ({ id, slug, family, familyName, fields, price, description }) => {
    const endpoint = `p/elevenlabs/${id}?m=t2a`;
    const model = studioModel({ provider: 'elevenlabs', mode: 't2a', slug, endpoint, family, familyName, vendorId: 'elevenlabs', fields, price, description });
    out.push({ key: endpoint, provider: 'elevenlabs', providerModel: id, mode: 't2a', kind: 'audio', family, model, server: { rename: { prompt: 'text' }, allowed: null, drop: [], fixed: {}, price } });
  };
  const ids = new Set(models.map((m) => m.model_id));
  for (const [id, spec] of Object.entries(ELEVEN_TTS)) {
    const m = models.find((x) => x.model_id === id);
    if (!m || m.can_do_text_to_speech === false) continue;
    const inputs = {
      voice_id: voice,
      ...(spec.v3
        ? { stability: { name: 'stability', title: 'Delivery', type: 'number', enum: [0, 0.5, 1], enumLabels: { 0: 'Creative', 0.5: 'Natural', 1: 'Robust' }, default: 0.5, description: 'Eleven v3 takes three stability levels.' } }
        : {
          stability: slider('stability', 'Stability', 0, 1, 0.05, 0.5, 'Lower: more emotional range; higher: steadier.'),
          similarity_boost: slider('similarity_boost', 'Similarity', 0, 1, 0.05, 0.75, 'How close to the original voice.'),
          style: slider('style', 'Style', 0, 1, 0.05, 0, 'Exaggerates the speaker\'s style; 0 is steadiest.'),
          speed: slider('speed', 'Speed', 0.7, 1.2, 0.05, 1, '1 is normal.'),
        }),
      seed: { name: 'seed', title: 'Seed', type: 'int', minValue: 0, maxValue: 4294967295, description: 'Empty: a new one each time' },
    };
    add({
      id, slug: id.replace(/_/g, '-'), family: spec.family, familyName: spec.name,
      fields: { inputs, hasPrompt: true, promptRequired: true, required: [], ...(spec.max ? { maxPromptLength: spec.max } : {}) },
      price: { usd: spec.usd, unit: 'chars', perChars: 1000 },
      description: m.description || undefined,
    });
  }
  // Any recording in your voice (or another one of yours).
  if (ids.has(ELEVEN_STS_MODEL)) {
    add({
      id: 'voice-changer', slug: 'voice-changer', family: 'elevenlabs-voice-changer', familyName: 'ElevenLabs Voice Changer',
      fields: {
        inputs: {
          audio: { name: 'audio', title: 'Recording', type: 'string', field: 'audio' },
          voice_id: voice,
          remove_background_noise: { name: 'remove_background_noise', title: 'Remove background noise', type: 'boolean', default: false },
          stability: slider('stability', 'Stability', 0, 1, 0.05, 0.5),
          similarity_boost: slider('similarity_boost', 'Similarity', 0, 1, 0.05, 0.75),
        },
        hasPrompt: false, promptRequired: false, required: ['audio'],
      },
      price: { usd: 0.12, unit: 'minute', from: true },
      description: 'Says your recording again in the chosen voice: same words, timing and emotion.',
    });
  }
  add({
    id: 'sound-effects', slug: 'sound-effects', family: 'elevenlabs-sound-effects', familyName: 'ElevenLabs Sound Effects',
    fields: {
      inputs: {
        duration_seconds: { name: 'duration_seconds', title: 'Length (s)', type: 'number', minValue: 0.5, maxValue: 30, step: 0.5, description: 'Empty: the model decides' },
        prompt_influence: slider('prompt_influence', 'Follow the text', 0, 1, 0.05, 0.3, 'Higher: closer to the words, less variation.'),
        loop: { name: 'loop', title: 'Seamless loop', type: 'boolean', default: false },
      },
      hasPrompt: true, promptRequired: true, required: [],
    },
    price: { usd: 0.12, unit: 'minute', from: true },
    description: 'A sound from a description: footsteps on gravel, a door slam, rain on a tin roof.',
  });
  return out;
}
export const ELEVEN_STS_MODEL = 'eleven_multilingual_sts_v2';

// ── Merge into studio lists ───────────────────────────────────────────────

// Within a family, the cheaper provider is listed last: the studio treats the
// last entry as the freshest and picks it by default.
function sortKey(v) {
  const p = v.server.price;
  const values = p?.byResolution ? Object.values(p.byResolution) : [];
  const usd = values.length ? Math.min(...values) : p?.usd;
  return Number.isFinite(usd) ? usd : 1e9;
}

export function buildStudioLists(variants, { recommended = [] } = {}) {
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
  // Logos: Atlas has them, APIMart doesn't — a model gets its family's logo,
  // or its vendor's, from whichever provider has one.
  const familyLogo = new Map();
  const vendorCounts = new Map(); // vendor -> Map(logo -> count)
  for (const v of variants) {
    if (v.logos?.model && !familyLogo.has(v.family)) familyLogo.set(v.family, v.logos.model);
    if (v.logos?.vendor) {
      if (!vendorCounts.has(v.model.provider)) vendorCounts.set(v.model.provider, new Map());
      const counts = vendorCounts.get(v.model.provider);
      counts.set(v.logos.vendor, (counts.get(v.logos.vendor) || 0) + 1);
    }
  }
  // The vendor's logo is the one most of its models use (its brand mark).
  const vendorLogo = new Map([...vendorCounts].map(([vendor, counts]) => [vendor, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
  const seenIds = new Set();
  for (const group of byFamilyMode.values()) {
    group.sort((a, b) => sortKey(b) - sortKey(a));
    for (const v of group) {
      // Ids must be unique: the studio looks models up by id.
      let id = v.model.id;
      for (let n = 2; seenIds.has(id); n += 1) id = `${v.model.id}-${n}`;
      v.model.id = id;
      seenIds.add(id);
      const familyName = familyNames.get(v.family)?.name || v.model.dzFamilyName;
      v.model.dzFamilyName = familyName;
      v.model.dzVendorLogo = vendorLogo.get(v.model.provider) || undefined;
      v.model.dzLogo = familyLogo.get(v.family) || v.model.dzVendorLogo;
      v.model.name = [familyName, v.model.dzProviderName, v.model.dzPrice?.label, v.model.dzBasic ? 'basic' : ''].filter(Boolean).join(' · ');
      lists[v.mode].push(v.model);
    }
  }
  // Recommended families go first, in the admin's order. The sort is stable,
  // so the order of providers inside a family (cheapest last = default) holds.
  const rank = new Map(recommended.map((key, i) => [key, i + 1]));
  for (const mode of Object.keys(lists)) {
    for (const m of lists[mode]) {
      if (rank.has(m.dzFamily)) m.dzRecommended = rank.get(m.dzFamily);
      else delete m.dzRecommended;
    }
    lists[mode].sort((a, b) => (a.dzRecommended || 1e9) - (b.dzRecommended || 1e9));
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
  // A "from" price is a lower bound (resolution and audio cost extra), not an
  // estimate: treat it as unknown so a spending limit can't be undercounted.
  if (!p || p.from) return null;
  const res = String(body?.resolution || '').toLowerCase();
  const unitPrice = (p.byResolution && (p.byResolution[res] ?? p.byResolution[res.replace(/p$/, 'p')])) ?? p.usd;
  if (p.unit === 'second') return unitPrice * (Number(body?.duration) || 5);
  if (p.unit === 'chars') return unitPrice * Math.max(1, String(body?.text ?? body?.input ?? body?.prompt ?? '').length / p.perChars);
  const n = Number(body?.n || body?.num_images || 1) || 1;
  return unitPrice * n;
}
