// Converts provider JSON-schema fields into the studio's input format
// (the format of packages/studio/src/models.js: enum / int with min-max /
// boolean / string, plus imageField / videoField / audioField for uploads).

// Fields the user never sets in the UI.
export const HIDDEN_FIELDS = new Set([
  'model', 'enable_base64_output', 'enable_sync_mode', 'webhook', 'webhook_secret', 'webhook_url',
  'storage_mode', 'enable_safety_checker', 'moderation', 'moderation_mode', 'safety_tolerance',
  'messages', 'metadata', 'from_task', 'callback_url', 'nsfw_check', 'return_last_frame',
]);

// Fields our UI cannot fill; a model that *requires* one of them is skipped.
export const UNSUPPORTED_FIELDS = new Set(['mask_image', 'mask_url', 'elements', 'loras', 'multi_prompt', 'keyframes', 'image_with_roles']);

const MEDIA_NAME = {
  image: /^(image|images|image_url|image_urls|img|reference_images|reference_image|first_frame|first_frame_image|start_image|start_frame|last_image|last_frame|last_frame_image|end_image|end_frame|middle_images|product_image|face_image|subject_image|style_image|input_image|input_images)$/,
  video: /^(video|videos|video_url|video_urls|reference_videos|reference_video|input_video|source_video)$/,
  audio: /^(audio|audios|audio_url|audio_urls|reference_audios|reference_audio|input_audio|driving_audio|voice_audio)$/,
};
const LAST_IMAGE = /^(last_image|last_frame|last_frame_image|end_image|end_frame)$/;
const PRIMARY_ORDER = {
  image: ['image', 'image_url', 'first_frame', 'first_frame_image', 'start_image', 'start_frame', 'images', 'image_urls', 'reference_images', 'input_image', 'input_images', 'product_image', 'img'],
  video: ['video', 'video_url', 'input_video', 'source_video', 'videos', 'video_urls', 'reference_videos'],
  audio: ['audio', 'audio_url', 'input_audio', 'driving_audio', 'audios', 'audio_urls', 'reference_audios'],
};

export function mediaTypeOf(name, prop = {}) {
  const fmt = prop['x-format'];
  const isUrlish = prop.type === 'string' || (prop.type === 'array' && (!prop.items || prop.items.type === 'string')) || !prop.type;
  if (!isUrlish) return null;
  if (['image', 'video', 'audio'].includes(fmt)) return fmt;
  for (const [type, re] of Object.entries(MEDIA_NAME)) if (re.test(name)) return type;
  return null;
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const titleOf = (name, prop) => prop.title || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// One field → studio input, or null when it should not be shown.
export function toStudioInput(name, prop = {}) {
  const base = { name, title: titleOf(name, prop), description: prop.description ? String(prop.description).slice(0, 300) : undefined };
  const def = prop.default;
  if (Array.isArray(prop.enum) && prop.enum.length) {
    const numeric = prop.enum.every((v) => typeof v === 'number');
    // Readable names for opaque ids (voices: "Bella · en-US · female"), from Atlas's x-enum-options.
    const opts = prop['x-enum-options'];
    const enumLabels = opts && typeof opts === 'object' ? Object.fromEntries(prop.enum.filter((v) => opts[v]?.name).map((v) => [v, [opts[v].name, opts[v].language, opts[v].gender].filter((x) => typeof x === 'string' && x).join(' · ').slice(0, 80)])) : null;
    return clean({ ...base, type: numeric ? (prop.enum.every(Number.isInteger) ? 'int' : 'number') : 'string', enum: prop.enum, enumLabels: enumLabels && Object.keys(enumLabels).length ? enumLabels : undefined, default: prop.enum.includes(def) ? def : prop.enum[0] });
  }
  switch (prop.type) {
    case 'integer':
      return clean({ ...base, type: 'int', minValue: prop.minimum, maxValue: prop.maximum, step: prop.step ?? 1, default: def });
    case 'number':
      return clean({ ...base, type: 'number', minValue: prop.minimum, maxValue: prop.maximum, step: prop.step ?? (prop.maximum != null && prop.maximum <= 2 ? 0.05 : 0.1), default: def });
    case 'boolean':
      return clean({ ...base, type: 'boolean', default: Boolean(def) });
    case 'string':
      // Providers put sample prompts into defaults; don't pre-fill them.
      return clean({ ...base, type: 'string', default: typeof def === 'string' && def.length <= 40 ? def : undefined });
    case 'array':
      if (prop.items && prop.items.type && prop.items.type !== 'string') return null;
      return clean({ ...base, type: 'array', items: { type: 'string' }, maxItems: prop.maxItems });
    default:
      return null;
  }
}

// { type: 'elements', format: 'kling', maxItems, maxVideo, nameMax, descMax, refMax }
// when the field takes subjects defined by name + images (and maybe a video).
export function elementsSpec(prop = {}) {
  const item = prop.items?.properties;
  if (prop.type !== 'array' || !item?.element_name || !item?.reference_type) return null;
  const types = item.reference_type.enum || [];
  const desc = String(prop.description || '');
  const video = types.includes('video_refer');
  const maxVideo = video ? Number((/at most (\d+) video/i.exec(desc) || [])[1]) || 1 : 0;
  return {
    name: 'elements', title: 'Elements', type: 'elements', field: 'element', format: 'kling',
    maxItems: prop.maxItems || 7,
    maxVideo,
    nameMax: Number((/max (\d+) characters/i.exec(item.element_name.description || '') || [])[1]) || 20,
    descMax: Number((/max (\d+) characters/i.exec(item.element_description?.description || '') || [])[1]) || 100,
    refMax: item.refer_images?.maxItems || 3,
    images: types.includes('image_refer'),
  };
}

// Builds studio inputs + media capability fields from a JSON schema.
// Returns null if the model needs something our UI cannot provide.
export function studioFieldsFromSchema(properties = {}, required = [], { renames = {} } = {}) {
  const inputs = {};
  const media = { image: [], video: [], audio: [] };
  for (const name of required) if (UNSUPPORTED_FIELDS.has(name)) return null;

  for (const [rawName, prop] of Object.entries(properties)) {
    if (HIDDEN_FIELDS.has(rawName)) continue;
    // Kling-style subjects (name + front image + more images, or a person video):
    // our Elements fill them. Other providers' "elements" stay unsupported.
    const subject = rawName === 'elements' && elementsSpec(prop);
    if (subject) { inputs.elements = subject; continue; }
    if (UNSUPPORTED_FIELDS.has(rawName)) continue;
    const name = renames[rawName] || rawName;
    const type = mediaTypeOf(rawName, prop);
    if (type) {
      media[type].push({ name, prop });
      inputs[name] = clean({ name, title: titleOf(rawName, prop), type: prop.type === 'array' ? 'array' : 'string', field: type, maxItems: prop.maxItems, items: prop.type === 'array' ? { type: 'string' } : undefined });
      continue;
    }
    const input = toStudioInput(name, prop);
    if (input) inputs[name] = input;
  }

  const fields = {};
  for (const type of ['image', 'video', 'audio']) {
    const list = media[type];
    if (!list.length) continue;
    const primary = PRIMARY_ORDER[type].map((n) => list.find((m) => m.name === n)).find(Boolean)
      || list.find((m) => !(type === 'image' && LAST_IMAGE.test(m.name)));
    if (!primary) continue;
    const isArray = primary.prop.type === 'array';
    const max = isArray ? (primary.prop.maxItems || 4) : 1;
    if (type === 'image') { fields.imageField = primary.name; fields.maxImages = max; }
    if (type === 'video') { fields.videoField = primary.name; fields.maxVideos = max; }
    if (type === 'audio') { fields.audioField = primary.name; fields.maxAudios = max; }
    if (type === 'image') {
      const last = list.find((m) => LAST_IMAGE.test(m.name));
      if (last && last !== primary) fields.lastImageField = last.name;
    }
  }

  // The prompt box: the model's "prompt", or a field renamed to it (speech models' "text").
  const promptRaw = Object.hasOwn(properties, 'prompt') ? 'prompt' : Object.keys(renames).find((k) => renames[k] === 'prompt' && Object.hasOwn(properties, k));
  const hasPrompt = Boolean(promptRaw);
  if (promptRaw && promptRaw !== 'prompt') delete inputs.prompt; // shown as the prompt box, not as a setting
  return {
    inputs,
    ...fields,
    hasPrompt,
    promptRequired: hasPrompt && required.includes(promptRaw),
    required: required.filter((n) => !HIDDEN_FIELDS.has(n)).map((n) => renames[n] || n),
  };
}
