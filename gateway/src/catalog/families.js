// One model often exists at several providers under different names
// (APIMart "kling-v4", Atlas "kwaivgi/kling-v4.0/text-to-video"). A family key
// puts them in one row of the model picker.

// Names that heuristics cannot match. Key: provider model id (or Atlas base).
const ALIASES = {
  apimart: {
    'gemini-3-pro-image-preview': 'nano-banana-pro',
    'gemini-3-pro-image-preview-official': 'nano-banana-pro-official',
    'gemini-3.1-flash-image-preview': 'nano-banana-2',
    'gemini-3.1-flash-image-preview-official': 'nano-banana-2-official',
    'gemini-2.5-flash-image-preview': 'nano-banana',
    'gemini-2.5-flash-image-preview-official': 'nano-banana-official',
    'gemini-3.1-flash-lite-image': 'nano-banana-2-lite',
    'MiniMax-H3': 'minimax-h3',
    'MiniMax-H3-Max': 'minimax-h3-max',
    'MiniMax-Hailuo-02': 'minimax-hailuo-02',
    'MiniMax-Hailuo-2.3': 'minimax-hailuo-2.3',
    'MiniMax-Hailuo-2.3-Fast': 'minimax-hailuo-2.3-fast',
  },
  atlas: {
    'google/nano-banana-2': 'nano-banana-2',
    'minimax/h3': 'minimax-h3',
    'minimax/h3-max': 'minimax-h3-max',
  },
};

const MODE_WORDS = /[-_ ](text-to-image|image-to-image|text-to-video|image-to-video|reference-to-video|video-to-video|start-end-frame-to-video|first-last-frame-to-video|keyframes-to-video|video-edit|image-edit|edit|t2i|i2i|t2v|i2v|v2v)$/i;

export function normalizeFamilyKey(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/(^|-)v(?=\d)/g, '$1') // kling-v4 → kling-4
    .replace(/(\d)-(\d)/g, '$1.$2') // seedance-2-5 → seedance-2.5
    .replace(/([a-z])(\d)/g, '$1-$2') // veo3.1 → veo-3.1
    .replace(/(\d+)\.0(?=$|-)/g, '$1') // 4.0 → 4
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Atlas ids: vendor/base[/mode-with-optional-variant]
export function atlasParts(modelId) {
  const [vendor, base, modePart = ''] = modelId.split('/');
  // "text-to-image-ultra" → mode "text-to-image", variant "ultra"
  const m = /^(text-to-image|image-to-image|text-to-video|image-to-video|reference-to-video|video-to-video|start-end-frame-to-video|video-edit|image-edit|edit)(?:-(.+))?$/.exec(modePart);
  // An unknown last segment is a separate tool of that model ("layer-decomposition",
  // "upscale"…): it becomes a variant, so it gets its own family and id.
  return { vendor, base: base || vendor, mode: m ? m[1] : modePart, variant: m ? m[2] || '' : modePart };
}

export function familyFor(providerId, modelId) {
  const alias = ALIASES[providerId]?.[modelId];
  if (alias) return normalizeFamilyKey(alias);
  if (providerId === 'atlas') {
    const { vendor, base, variant } = atlasParts(modelId);
    const baseAlias = ALIASES.atlas[`${vendor}/${base}`];
    const key = baseAlias || base;
    return normalizeFamilyKey(variant ? `${key}-${variant}` : key);
  }
  return normalizeFamilyKey(String(modelId).replace(MODE_WORDS, ''));
}

const SPECIAL = { gpt: 'GPT', ai: 'AI', hd: 'HD', ii: 'II', mj: 'MJ', ltx: 'LTX', glm: 'GLM', z: 'Z', h: 'H' };
export function prettyFamilyName(key) {
  return key.split('-').map((w) => SPECIAL[w] || (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ')
    .replace(/(\D) (\d)/g, '$1 $2');
}

// "Kling Video 4.0 Text-to-Video" → "Kling Video 4.0"
export function stripModeWords(name) {
  return String(name || '')
    .replace(/\s+(Text|Image|Video|Reference|Start-End[- ]Frame|First-Last[- ]Frame|Keyframes)[- ]to[- ](Image|Video)\b/gi, '')
    .replace(/\s+(Video[- ]Edit|Image[- ]Edit|Edit)\b/gi, '')
    .trim();
}
