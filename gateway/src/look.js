// Camera look: camera, lens, focal length, aperture, filter, era, light and
// the camera move. The studio sends the chosen ids (`_dz.look`); the words a
// model gets are made here, by that model's rules (where the look goes in
// the prompt and under which block), so the browser never builds them.
//
// Words follow the official prompt guides (src/prompt-memos, their sources):
// models read the effect ("shallow depth of field", "compressed background")
// better than bare numbers, so every value carries both; real camera / film /
// lens names work as look cues. Research: docs/camera-lens-research.md.

// sensor: 'small' formats rarely blur the background much; 'large' do it easily.
export const CAMERAS = [
  { id: 'digital', label: 'Digital Cinema', note: 'Clean modern cinema look', text: 'ARRI Alexa 35 digital cinema camera, clean natural color' },
  { id: 'large-format', label: 'Large Format', note: 'Immersive, very shallow depth of field', text: 'ARRI Alexa 65 large-format camera, immersive perspective, very shallow depth of field', sensor: 'large' },
  { id: 'film-35', label: '35mm Film', note: 'Classic film grain and color', text: '35mm film camera, Kodak Vision3 500T stock, fine grain, organic film color' },
  { id: 'film-16', label: '16mm Film', note: 'Grainy, documentary texture', text: '16mm film camera, visible grain, documentary texture', sensor: 'small' },
  { id: 'super-8', label: 'Super 8', note: 'Home movie, heavy grain', text: 'Super 8 home-movie film, heavy grain, soft focus, faded color, light leaks', sensor: 'small' },
  { id: 'imax-70', label: 'IMAX 70mm', note: 'Epic scale, ultra detail', text: '65mm IMAX film camera, ultra-detailed, epic scale', sensor: 'large' },
  { id: 'dv', label: 'DV Camcorder', note: 'Early-2000s video', text: 'early-2000s DV camcorder, video sharpness, slight interlacing, consumer video color', sensor: 'small' },
  { id: 'vhs', label: 'VHS', note: '90s tape: soft, color bleed', text: '1990s VHS camcorder tape, low resolution, color bleeding, tracking noise', sensor: 'small' },
  { id: 'phone', label: 'Phone', note: 'Modern smartphone / vlog', text: 'modern smartphone camera, deep focus, crisp computational look', sensor: 'small' },
];

// focal: the range this kind of lens is made in; aperture: the widest f-number where its effect shows.
export const LENSES = [
  { id: 'clean', label: 'Clean Prime', note: 'Sharp, neutral, modern', text: 'modern spherical prime lens, clinically sharp, neutral rendering' },
  { id: 'vintage-prime', label: 'Vintage Prime', note: 'Soft contrast, warm flare', text: 'vintage cinema prime lens, soft contrast, warm gentle flares', focal: [16, 135] },
  { id: 'anamorphic', label: 'Anamorphic', note: 'Oval bokeh, streak flares, widescreen', text: 'anamorphic lens, oval bokeh, horizontal blue streak flares, 2.39:1 widescreen feel', focal: [24, 135], wide: true },
  { id: 'vintage-anamorphic', label: 'Vintage Anamorphic', note: 'Warm streaks, soft edges', text: 'vintage anamorphic lens, warm amber streak flares, soft edges, oval bokeh', focal: [35, 135], wide: true },
  { id: 'petzval', label: 'Petzval Swirl', note: 'Swirling bokeh portrait lens', text: 'Petzval portrait lens, swirling bokeh, sharp center falling off to the edges', focal: [50, 85], maxAperture: 2 },
  { id: 'macro', label: 'Macro', note: 'Extreme close detail', text: 'macro lens, extreme close-up detail', focal: [50, 135] },
  { id: 'fisheye', label: 'Fisheye', note: 'Strong curved distortion', text: 'fisheye lens, strong barrel distortion, curved horizon', focal: [8, 16] },
  { id: 'tilt-shift', label: 'Tilt-Shift', note: 'Miniature effect', text: 'tilt-shift lens, miniature effect, narrow tilted plane of focus', focal: [16, 85] },
  { id: 'vintage-zoom', label: 'Vintage Zoom', note: '70s zoom look', text: '1970s cinema zoom lens look, soft, slight focus breathing' },
];

export const FILTERS = [
  { id: 'diffusion', label: 'Diffusion / Halation', note: 'Glowing highlights, softer skin', text: 'Black Pro-Mist diffusion filter, glowing halation around highlights' },
];

export const FOCALS = [
  { mm: 12, text: 'ultra-wide, strong perspective distortion' },
  { mm: 16, text: 'very wide, exaggerated depth' },
  { mm: 24, text: 'wide, expansive' },
  { mm: 35, text: 'natural documentary perspective' },
  { mm: 50, text: 'normal human-eye perspective' },
  { mm: 85, text: 'portrait lens, compressed background' },
  { mm: 135, text: 'telephoto, strong background compression' },
  { mm: 200, text: 'long telephoto, flattened depth' },
];

export const APERTURES = [
  { f: 'f/1.4', n: 1.4, text: 'very shallow depth of field, creamy bokeh' },
  { f: 'f/2', n: 2, text: 'shallow depth of field, soft background' },
  { f: 'f/2.8', n: 2.8, text: 'shallow depth of field, subject isolated' },
  { f: 'f/4', n: 4, text: 'moderate depth of field' },
  { f: 'f/5.6', n: 5.6, text: 'balanced depth of field' },
  { f: 'f/8', n: 8, text: 'deep depth of field' },
  { f: 'f/11', n: 11, text: 'deep focus, sharp foreground to background' },
  { f: 'f/16', n: 16, text: 'everything in sharp focus' },
];

export const ERAS = [
  { id: '1920s', label: '1920s', text: '1920s period: black-and-white silent-film look, flicker, vignetting, period costumes and sets' },
  { id: '1940s', label: '1940s', text: '1940s period: black-and-white film noir contrast, period costumes, cars and sets' },
  { id: '1950s', label: '1950s', text: '1950s period: saturated Technicolor color, period costumes, cars and production design' },
  { id: '1960s', label: '1960s', text: '1960s period: soft pastel film color, period fashion and production design' },
  { id: '1970s', label: '1970s', text: '1970s period: warm faded film color, soft grain, period costumes, cars and interiors' },
  { id: '1980s', label: '1980s', text: '1980s period: punchy saturated color, neon accents, period fashion and technology' },
  { id: '1990s', label: '1990s', text: '1990s period: slightly muted film color, period fashion, cars and technology' },
  { id: '2000s', label: '2000s', text: '2000s period: digital-era color, period fashion, phones and technology' },
  { id: 'today', label: 'Today', text: 'present day: contemporary fashion, technology and setting' },
  { id: 'near-future', label: 'Near future', text: 'near-future setting: sleek believable technology, subtle sci-fi design' },
];

export const LIGHTS = [
  { id: 'natural', label: 'Natural daylight', text: 'soft natural daylight' },
  { id: 'golden-hour', label: 'Golden hour', text: 'warm low golden-hour sunlight, long shadows, glowing rim light' },
  { id: 'blue-hour', label: 'Blue hour', text: 'cool blue-hour twilight, soft ambient light' },
  { id: 'overcast', label: 'Overcast soft', text: 'flat soft overcast light, gentle shadows' },
  { id: 'hard-sun', label: 'Hard midday sun', text: 'hard midday sun, crisp dark shadows, high contrast' },
  { id: 'low-key', label: 'Low-key', text: 'low-key chiaroscuro lighting, deep shadows, single hard key light' },
  { id: 'high-key', label: 'High-key', text: 'bright high-key lighting, minimal shadows' },
  { id: 'neon', label: 'Neon night', text: 'night lit by colored neon signs, magenta and cyan reflections' },
  { id: 'practical', label: 'Warm practicals', text: 'warm practical light from lamps and candles, cozy pools of light' },
  { id: 'moonlight', label: 'Moonlight', text: 'cool blue moonlight, dark night scene' },
  { id: 'backlit', label: 'Backlit / silhouette', text: 'strong backlight, silhouette with glowing rim' },
  { id: 'studio', label: 'Studio softbox', text: 'clean studio softbox key light with soft fill' },
];

// Colour palette and genre (redesign 01, Look panel). Left on Auto, the model decides.
export const PALETTES = [
  { id: 'teal-orange', label: 'Teal and orange', text: 'teal-and-orange color grade, warm skin against cool shadows' },
  { id: 'warm-film', label: 'Warm film', text: 'warm analog film color, soft amber tones, gentle grain' },
  { id: 'noir', label: 'Noir', text: 'black-and-white noir grade, deep blacks, hard contrast' },
  { id: 'neon-night', label: 'Neon night', text: 'saturated neon palette, magenta and cyan accents in the dark' },
  { id: 'pastel', label: 'Pastel', text: 'soft pastel palette, light airy colors, low contrast' },
  { id: 'bleach-bypass', label: 'Bleach bypass', text: 'bleach-bypass look, desaturated colors, silvery high contrast' },
  { id: 'natural', label: 'Natural', text: 'natural true-to-life colors, neutral grade' },
];
export const GENRES = [
  { id: 'drama', label: 'Drama', text: 'grounded dramatic film tone, intimate and emotional' },
  { id: 'thriller', label: 'Thriller', text: 'tense thriller tone, suspenseful and moody' },
  { id: 'commercial', label: 'Commercial', text: 'polished commercial look, clean and aspirational' },
  { id: 'documentary', label: 'Documentary', text: 'observational documentary feel, natural and unstaged' },
  { id: 'music-video', label: 'Music video', text: 'stylized music-video look, bold and rhythmic' },
];

// Camera moves for video, written the way video models understand them.
export const MOVES = [
  { id: 'static', label: 'Static', text: 'static locked-off camera, no camera movement' },
  { id: 'dolly-in', label: 'Dolly in', text: 'slow dolly-in toward the subject' },
  { id: 'dolly-out', label: 'Dolly out', text: 'slow dolly-out away from the subject, revealing the surroundings' },
  { id: 'push-in', label: 'Push in (fast)', text: 'fast push-in on the subject' },
  { id: 'pan-left', label: 'Pan left', text: 'smooth pan to the left' },
  { id: 'pan-right', label: 'Pan right', text: 'smooth pan to the right' },
  { id: 'tilt-up', label: 'Tilt up', text: 'slow tilt up' },
  { id: 'tilt-down', label: 'Tilt down', text: 'slow tilt down' },
  { id: 'truck-left', label: 'Truck left', text: 'camera trucks left alongside the subject' },
  { id: 'truck-right', label: 'Truck right', text: 'camera trucks right alongside the subject' },
  { id: 'orbit', label: 'Orbit', text: 'camera orbits around the subject in a smooth arc' },
  { id: 'crane-up', label: 'Crane up', text: 'crane shot rising up and over the scene' },
  { id: 'crane-down', label: 'Crane down', text: 'crane shot descending toward the subject' },
  { id: 'tracking', label: 'Tracking', text: 'tracking shot following the subject' },
  { id: 'handheld', label: 'Handheld', text: 'handheld camera with subtle natural shake' },
  { id: 'drone', label: 'Drone / FPV', text: 'aerial drone shot flying over the scene' },
  { id: 'zoom-in', label: 'Zoom in', text: 'slow optical zoom in' },
  { id: 'dolly-zoom', label: 'Dolly zoom', text: 'dolly zoom (vertigo effect) on the subject' },
];

export const DEFAULT_LOOK = { camera: 'digital', lens: 'clean', focal: 35, aperture: 'f/4' };

// Names used before 18.11 (saved settings, storyboards, history) → today's ids.
const LEGACY_CAMERA = {
  'Modular 8K Digital': 'digital', 'Full-Frame Cine Digital': 'digital', 'Studio Digital S35': 'digital',
  'Grand Format 70mm Film': 'imax-70', 'Classic 16mm Film': 'film-16', 'Premium Large Format Digital': 'large-format',
};
const LEGACY_LENS = {
  'Premium Modern Prime': 'clean', 'Clinical Sharp Prime': 'clean', 'Classic Anamorphic': 'anamorphic', 'Compact Anamorphic': 'anamorphic',
  '70s Cinema Prime': 'vintage-prime', 'Warm Cinema Prime': 'vintage-prime', 'Vintage Prime': 'vintage-prime', 'Swirl Bokeh Portrait': 'petzval',
  'Halation Diffusion': 'clean', 'Creative Tilt Lens': 'tilt-shift', 'Extreme Macro': 'macro',
};
const LEGACY_FOCAL = { 8: 12, 14: 16 };

const byId = (list, id) => list.find((x) => x.id === id) || null;
const nearestFocal = (n) => FOCALS.reduce((best, f) => (Math.abs(f.mm - n) < Math.abs(best.mm - n) ? f : best), FOCALS[0]).mm;

// A look from the browser (or a saved one), made safe: known ids only.
// "film-35 (Classic film grain)" → "film-35": text models sometimes copy the description.
const idOf = (v) => (typeof v === 'string' ? v.replace(/\s*\(.*\)\s*$/, '').trim() : v);

export function cleanLook(input) {
  if (!input || typeof input !== 'object') return null;
  const raw = { ...input, camera: idOf(input.camera), lens: idOf(input.lens), era: idOf(input.era), light: idOf(input.light), move: idOf(input.move), filter: idOf(input.filter) };
  const camera = byId(CAMERAS, raw.camera)?.id || LEGACY_CAMERA[raw.camera] || null;
  const lens = byId(LENSES, raw.lens)?.id || LEGACY_LENS[raw.lens] || null;
  let focal = Number(String(raw.focal ?? '').replace(/mm$/i, ''));
  focal = Number.isFinite(focal) && focal > 0 ? nearestFocal(LEGACY_FOCAL[focal] || focal) : null;
  const aperture = APERTURES.find((a) => a.f === raw.aperture)?.f || null;
  const filter = byId(FILTERS, raw.filter)?.id || (raw.lens === 'Halation Diffusion' ? 'diffusion' : null);
  const out = {
    on: raw.on !== false && Boolean(camera || lens || focal || aperture),
    camera, lens, focal, aperture, filter,
    era: byId(ERAS, raw.era)?.id || null,
    light: byId(LIGHTS, raw.light)?.id || null,
    palette: byId(PALETTES, idOf(raw.palette))?.id || null,
    genre: byId(GENRES, idOf(raw.genre))?.id || null,
    move: byId(MOVES, raw.move)?.id || null,
  };
  return out.on || out.filter || out.era || out.light || out.palette || out.genre || out.move ? out : null;
}

// "Unusual" combinations: not an error — a hint (it may look great or odd).
export function lookHints(look, { kind = 'video', aspect = null, size = null } = {}) {
  const l = look || {};
  const hints = [];
  const lens = byId(LENSES, l.lens);
  const camera = byId(CAMERAS, l.camera);
  const ap = APERTURES.find((a) => a.f === l.aperture);
  if (l.on !== false && lens?.focal && l.focal && (l.focal < lens.focal[0] || l.focal > lens.focal[1])) {
    hints.push(`${lens.label} lenses are usually ${lens.focal[0]}–${lens.focal[1]} mm.`);
  }
  if (l.on !== false && lens?.maxAperture && ap && ap.n > lens.maxAperture) hints.push(`${lens.label} swirl shows only wide open (f/${lens.maxAperture} or wider).`);
  if (l.on !== false && lens?.id === 'macro' && ap && ap.n < 5.6) hints.push('Real macro is shot at f/8–f/16 — wide open only a sliver is sharp.');
  if (l.on !== false && camera?.sensor === 'small' && ap && ap.n <= 2) hints.push(`${camera.label} rarely gives strong background blur, even at ${ap.f}.`);
  if (l.on !== false && l.focal && l.focal <= 16 && /close-up/.test(String(size || ''))) hints.push('Very wide lenses distort faces in close-ups.');
  if (l.on !== false && lens?.wide && /^9:16|^3:4|^4:5/.test(String(aspect || ''))) hints.push('Anamorphic is a widescreen look; a vertical frame crops it.');
  if (kind === 'video' && l.move === 'zoom-in' && byId(LENSES, l.lens) && !['vintage-zoom'].includes(l.lens) && l.on !== false) hints.push('Prime lenses can’t zoom — the model may treat it as a push-in.');
  return hints.map((h) => `${h} Not typical in real shooting — the result can be great or odd. Experiment!`);
}

// Data the studio needs to draw the controls (labels and ranges, no prompt words).
export function lookForClient() {
  const pick = (list, keys) => list.map((x) => Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]])));
  return {
    cameras: pick(CAMERAS, ['id', 'label', 'note', 'sensor']),
    lenses: pick(LENSES, ['id', 'label', 'note', 'focal', 'maxAperture', 'wide']),
    filters: pick(FILTERS, ['id', 'label', 'note']),
    focals: FOCALS.map((f) => f.mm),
    apertures: APERTURES.map((a) => a.f),
    eras: pick(ERAS, ['id', 'label']),
    lights: pick(LIGHTS, ['id', 'label']),
    palettes: pick(PALETTES, ['id', 'label']),
    genres: pick(GENRES, ['id', 'label']),
    moves: pick(MOVES, ['id', 'label']),
    defaults: DEFAULT_LOOK,
  };
}

// The words: camera (with lens, focal, aperture, filter), move, light, era.
function words(look, kind) {
  const camera = byId(CAMERAS, look.camera);
  const lens = byId(LENSES, look.lens);
  const focal = FOCALS.find((f) => f.mm === look.focal);
  const ap = APERTURES.find((a) => a.f === look.aperture);
  const filter = byId(FILTERS, look.filter);
  const cam = look.on ? [
    camera ? `shot on ${camera.text}` : '',
    lens ? lens.text : '',
    focal ? `${focal.mm}mm (${focal.text})` : '',
    ap ? `${ap.f} (${ap.text})` : '',
  ].filter(Boolean) : [];
  if (filter) cam.push(filter.text);
  const move = kind === 'video' ? byId(MOVES, look.move)?.text || '' : '';
  return {
    camera: cam.join(', '),
    move,
    light: byId(LIGHTS, look.light)?.text || '',
    palette: byId(PALETTES, look.palette)?.text || '',
    genre: byId(GENRES, look.genre)?.text || '',
    era: byId(ERAS, look.era)?.text || '',
  };
}

// Where the look goes, per model (from its memo, see prompt-memos frontmatter
// "look"): "start" — a cinematography sentence first (Veo, Luma Ray guides);
// "blocks" — into the model's labeled blocks (Seedance Camera/Style, H3 Look…);
// otherwise "end" — appended (Kling, Wan prose, image models).
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sentence = (s) => (s ? `${cap(s.replace(/[.\s]+$/, ''))}.` : '');

// Appends `text` to an existing "Label:" line, or adds that line at the end.
function intoBlock(prompt, label, text) {
  if (!text) return prompt;
  const re = new RegExp(`^(\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:)(.*)$`, 'im');
  if (re.test(prompt)) return prompt.replace(re, (_, head, rest) => `${head}${rest.replace(/[.\s]*$/, '')}${rest.trim() ? '; ' : ' '}${text}.`);
  return `${prompt.replace(/\s+$/, '')}${prompt.trim() ? '\n' : ''}${label}: ${text}.`;
}

export function renderLook(prompt, look, { kind = 'video', memo = null } = {}) {
  const raw = String(prompt ?? '');
  if (!look) return raw;
  const w = words(look, kind);
  const parts = [w.camera, w.move, w.light, w.palette, w.genre, w.era];
  if (!parts.some(Boolean)) return raw;

  const rule = memo?.look || {};
  // A JSON prompt stays JSON: the look goes into the model's own keys (its
  // camera / style blocks, any letter case), added to what is already there.
  const text = raw.trim();
  if (/^[{[]/.test(text)) {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value) || !value || typeof value !== 'object') return raw; // a list has no place for keys
      const out = { ...value };
      const put = (name, t) => {
        if (!t) return;
        const k = Object.keys(out).find((x) => x.toLowerCase() === name.toLowerCase());
        if (k === undefined) out[name.toLowerCase()] = t;
        else if (typeof out[k] === 'string') out[k] = out[k].trim() ? `${out[k].trim().replace(/[.;,\s]+$/, '')}; ${t}` : t;
        else if (Array.isArray(out[k])) out[k] = [...out[k], t];
        else if (out[k] && typeof out[k] === 'object') out[k] = { ...out[k], look: [out[k].look, t].filter((x) => typeof x === 'string' && x).join('; ') };
        else out[k] = t;
      };
      if (rule.camera) put(rule.camera, [w.camera, w.move].filter(Boolean).join(', '));
      else { put('camera', w.camera); put('camera_movement', w.move); }
      if (rule.style) put(rule.style, [w.light, w.palette, w.genre, w.era].filter(Boolean).join(', '));
      else { put('lighting', w.light); put('color', w.palette); put('genre', w.genre); put('era', w.era); }
      return JSON.stringify(out, null, 2);
    } catch { /* not JSON after all: plain text */ }
  }

  // A prompt already written in the model's labeled blocks (e.g. by "Adapt to
  // model"): the look joins those blocks, whatever the model's usual place.
  const hasLabel = (label) => label && new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'im').test(text);
  if (rule.place === 'blocks' || hasLabel(rule.camera) || hasLabel(rule.style)) {
    const camLabel = rule.camera || 'Camera';
    const styleLabel = rule.style || camLabel;
    let out = text;
    out = intoBlock(out, camLabel, [w.camera, w.move].filter(Boolean).join(', '));
    out = intoBlock(out, styleLabel, [w.light, w.palette, w.genre, w.era].filter(Boolean).join(', '));
    return out;
  }
  const cameraSentence = sentence([w.camera, w.move].filter(Boolean).join(', '));
  const styleSentence = [sentence(w.light && `lighting: ${w.light}`), sentence(w.palette && `color: ${w.palette}`), sentence(w.genre), sentence(w.era)].filter(Boolean).join(' ');
  const body = text ? (/[.!?"')\]]$/.test(text) ? text : `${text.replace(/[,;:\s]+$/, '')}.`) : '';
  if (rule.place === 'start') return [cameraSentence, body, styleSentence].filter(Boolean).join(' ');
  return [body, cameraSentence, styleSentence].filter(Boolean).join(' ');
}
