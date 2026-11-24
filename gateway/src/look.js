// Camera look: camera, lens, focal length, aperture, filter, era, light and
// the camera move. The studio sends the chosen ids (`_dz.look`); the words a
// model gets are made here, by that model's rules (where the look goes in
// the prompt and under which block), so the browser never builds them.
//
// Words follow the official prompt guides (src/prompt-memos, their sources):
// models read the effect ("shallow depth of field", "compressed background")
// better than bare numbers, so every value carries both; real camera / film /
// lens names work as look cues. Research: docs/camera-lens-research.md.

// Seven cameras (handoff 17, §3). Modern is the default and adds nothing.
// shot + look: the camera's words for a video or picture made without a start frame
// (tested wording, §5/§7); keep: what the model must not draw. No grain, dust,
// scratches, light leaks or timestamps here: the texture filter adds those (§6), and
// drawn ones turn into real objects in a video. texture: the filter preset (§6).
// toneOnly: Kling draws a 4:3 picture with rounded corners when the medium is named,
// so it gets the colour and tone words only (§7).
// sensor: 'small' formats rarely blur the background much; 'large' do it easily.
export const CAMERAS = [
  { id: 'modern', label: 'Modern', note: 'Clean modern picture, nothing added' },
  { id: 'film-35', label: '35mm Film', note: 'Soft highlights, film colour, fine grain', texture: '35mm',
    shot: 'Shot on 35mm motion-picture colour negative film with a spherical cinema lens',
    look: 'soft highlight roll-off with a gentle glow around light sources, rich but slightly muted colour with warm skin and cool green-teal shadows, slightly soft detail, not digitally sharp',
    reshoot: { camera: 'on 35mm motion-picture colour negative film with a spherical cinema lens', look: 'Soft highlight roll-off with a gentle glow around light sources, rich but slightly muted colour with warm skin and cool green-teal shadows, slightly soft detail, not digitally sharp' } },
  { id: 'film-16', label: '16mm Film', note: 'Soft, faded colour, coarse grain', texture: '16mm', sensor: 'small',
    shot: 'Shot on 16mm colour film',
    look: 'soft lower-resolution detail, slightly lifted milky blacks, warm slightly faded colours, a gentle dark vignette in the corners',
    reshoot: { camera: 'on 16mm colour film', look: 'Soft lower-resolution detail, slightly lifted milky blacks, warm slightly faded colours, a gentle dark vignette in the corners' } },
  { id: 'super-8', label: '8mm Film', note: 'Home movie: warm cast, heavy grain, flicker', texture: '8mm', sensor: 'small', toneOnly: true,
    shot: 'A Super 8 home movie',
    look: 'soft blurry detail, strong warm yellow-red colour cast, faded blacks, heavy dark vignette in the corners',
    keep: 'No rounded corners, no sprocket holes',
    reshoot: { camera: 'as a frame of a Super 8 home movie', look: 'Soft blurry detail, strong warm yellow-red colour cast, faded blacks, heavy dark vignette in the corners. No rounded corners, no sprocket holes' } },
  { id: 'dv', label: 'DV Camcorder', note: 'Home video from 2000', texture: 'dv', sensor: 'small',
    shot: 'Amateur home video from the year 2000 recorded on MiniDV tape with a consumer camcorder',
    look: 'standard-definition video, over-sharpened edges, everything in focus, windows and lights blown out to flat white, muddy shadows, dull video colours with a slight green-magenta cast',
    keep: 'No text, no date stamp',
    reshoot: { camera: 'as a still frame of amateur home video from the year 2000 recorded on MiniDV tape with a consumer camcorder', look: 'Standard-definition video frame, over-sharpened edges, everything in focus, windows and lights blown out to flat white, muddy shadows, dull video colours with a slight green-magenta cast. No text, no date stamp' } },
  { id: 'vhs', label: 'VHS', note: '90s tape: soft, colour bleed', texture: 'vhs', sensor: 'small', toneOnly: true,
    shot: 'A 1990s VHS home recording',
    look: 'very soft low-resolution picture, washed-out contrast with greyish blacks, blown-out highlights',
    keep: 'No text, no timestamp',
    reshoot: { camera: 'as a paused frame of a 1990s VHS home recording', look: 'Very soft low-resolution picture, washed-out contrast with greyish blacks, blown-out highlights. No text, no timestamp' } },
  { id: 'phone', label: 'Phone', note: 'Modern smartphone, everything sharp', sensor: 'small',
    shot: 'Casual video filmed on a modern smartphone main camera',
    look: 'wide-angle phone lens held close, everything in sharp focus, computational HDR with bright lifted shadows, over-sharpened crisp detail, vivid colours, clean picture with no grain, no background blur',
    // Kling (§7): tested as one block; never "stretching at the frame edges" (gives fisheye).
    // "horizontal" only at 16:9; any other ratio drops the orientation word ("vertical" is not tested).
    kling: 'Casual {orient}video filmed by a friend on a modern smartphone main camera. Wide-angle phone lens held close, everything in sharp focus, computational HDR with bright lifted shadows, over-sharpened crisp detail, vivid colours, clean picture with no grain. Not cinematic, no background blur.',
    // §7 (23.11): how a phone moves, and no phone in the picture (Seedance drew one on the table).
    // Tested once on Kling and Seedance; untested on Wan and the other models. "phone" names the camera only.
    behaviour: 'Handheld phone video - small natural hand shake and slow drift, casual slightly off-centre framing, the exposure adjusts once, one brief autofocus breath. No phone or other device is visible in the picture',
    klingOnly: 'One continuous shot, no cuts',
    // No re-shoot wording: Phone widens the frame by canvas extension instead (§5.1, canvasPrompt).
  },
  // Cameras from before 23.11: kept as stored (settings, storyboards, history), shown and sent as Modern.
  { id: 'digital', label: 'Digital Cinema', as: 'modern', hidden: true },
  { id: 'large-format', label: 'Large Format', as: 'modern', hidden: true, sensor: 'large' },
  { id: 'imax-70', label: 'IMAX 70mm', as: 'modern', hidden: true, sensor: 'large' },
];
// The camera whose words and filter apply (an old camera → Modern, which has none).
export const cameraOf = (id) => { const c = CAMERAS.find((x) => x.id === id) || null; return c?.as ? CAMERAS.find((x) => x.id === c.as) : c; };
// The texture filter preset for a look (§6): film and video cameras only.
export const textureOf = (look) => (look && look.on !== false ? cameraOf(look.camera)?.texture || null : null);
// With a start frame (§4, rule 1): no camera, lens or aperture words, only this line.
export const KEEP_FRAME = 'Keep the lens, focus, colour and image texture of the first frame unchanged for the whole clip.';

// focal: the range this kind of lens is made in; aperture: the widest f-number where its effect shows.
export const LENSES = [
  { id: 'clean', label: 'Clean Prime', note: 'Sharp, neutral, modern', text: 'modern spherical prime lens, clinically sharp, neutral rendering' },
  { id: 'vintage-prime', effect: 'soft contrast, warm gentle flares', label: 'Vintage Prime', note: 'Soft contrast, warm flare', text: 'vintage cinema prime lens, soft contrast, warm gentle flares', focal: [16, 135] },
  { id: 'anamorphic', effect: 'oval out-of-focus highlights, horizontal blue streak flares', label: 'Anamorphic', note: 'Oval bokeh, streak flares, widescreen', text: 'anamorphic lens, oval bokeh, horizontal blue streak flares, 2.39:1 widescreen feel', focal: [24, 135], wide: true },
  { id: 'vintage-anamorphic', effect: 'warm amber streak flares, soft edges, oval out-of-focus highlights', label: 'Vintage Anamorphic', note: 'Warm streaks, soft edges', text: 'vintage anamorphic lens, warm amber streak flares, soft edges, oval bokeh', focal: [35, 135], wide: true },
  { id: 'petzval', effect: 'swirling out-of-focus background, sharp centre falling off to the edges', label: 'Petzval Swirl', note: 'Swirling bokeh portrait lens', text: 'Petzval portrait lens, swirling bokeh, sharp center falling off to the edges', focal: [50, 85], maxAperture: 2 },
  { id: 'macro', effect: 'extreme close-up detail', label: 'Macro', note: 'Extreme close detail', text: 'macro lens, extreme close-up detail', focal: [50, 135] },
  { id: 'fisheye', effect: 'strong barrel distortion, curved horizon', label: 'Fisheye', note: 'Strong curved distortion', text: 'fisheye lens, strong barrel distortion, curved horizon', focal: [8, 16] },
  { id: 'tilt-shift', effect: 'miniature effect, narrow tilted plane of focus', label: 'Tilt-Shift', note: 'Miniature effect', text: 'tilt-shift lens, miniature effect, narrow tilted plane of focus', focal: [16, 85] },
  { id: 'vintage-zoom', effect: '1970s look, soft, slight focus breathing', label: 'Vintage Zoom', note: '70s zoom look', text: '1970s cinema zoom lens look, soft, slight focus breathing' },
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

// Block mode (docs/ux/43 §3, 44 §C): shot size for FRAMING. The wording states the target
// itself through the frame edges (stage 13/15 wording, measured in REPORT-shot-size.md).
// "knees" is untested. A target, not a guarantee: runs differ by about ×1.3.
export const SHOTS = [
  { id: 'full', label: 'full body', framing: 'Full-body shot. Top edge of the frame just above the head, bottom edge just below the feet. The whole body from head to feet is visible, with floor under the feet.' },
  { id: 'knees', label: 'knees up', framing: 'Knees-up shot. Top edge of the frame just above the head, bottom edge at the knees. Lower legs and feet are outside the frame.' },
  { id: 'waist', label: 'waist up', framing: 'Waist-up shot. Top edge of the frame just above the head, bottom edge at the waist. Hips, legs and feet are outside the frame.' },
  { id: 'head-shoulders', label: 'head and shoulders', framing: 'Head-and-shoulders shot. Top edge of the frame just above the head, bottom edge at mid-chest. Waist, hands and legs are outside the frame.' },
  { id: 'face', label: 'face', framing: 'Face close-up. Top edge of the frame at the hairline, bottom edge just below the chin. The face fills the frame; shoulders are outside the frame.' },
];
export const HOLD_CLOSE = 'The camera never moves back and never zooms out. The framing is identical from the first frame to the last.';
// Focal length → default shot size (doc 42, answer 3). A shot size set elsewhere wins.
export const FOCAL_SHOT = { 12: 'full', 16: 'full', 24: 'full', 35: 'knees', 50: 'waist', 85: 'head-shoulders', 135: 'face', 200: 'face' };
// Storyboard shot sizes (dzDirector.js SHOT_SIZES) → ours.
const STORYBOARD_SHOT = { 'extreme wide': 'full', wide: 'full', full: 'full', 'medium wide': 'knees', medium: 'waist', 'medium close-up': 'head-shoulders', 'close-up': 'face', 'extreme close-up': 'face', insert: null };
// "insert" (a detail of an object) has no person to frame: no FRAMING.
export const shotOf = (v) => SHOTS.find((x) => x.id === v)?.id || STORYBOARD_SHOT[String(v || '').toLowerCase()] || null;
// FOCUS from the aperture: only the three steps tested in stage 9 (REPORT7 §8). The middle
// step is measurably softer but looks almost like the deep one; Kling may move closer on the shallow one.
const FOCUS_STEPS = [
  { max: 2.8, text: 'Subject critically sharp. Background fully defocused: lights become large soft glowing discs, background details unreadable.' },
  { max: 5.6, text: 'Subject sharp. Background slightly soft: background objects still readable, their edges gently softened.' },
  // Stage 16 (docs/ux/39, measured in REPORT-shot-size): "equally sharp … not blurred at all", as its own
  // FOCUS block, lifted Seedance's background sharpness 2.3× (to Kling's level). The tested line named the
  // scene's own objects; this is the same wording without them.
  { max: Infinity, text: 'Deep focus. Everything in the frame is equally sharp, from the subject to the far background. The background is not blurred at all.' },
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

export const DEFAULT_LOOK = { camera: 'modern', lens: 'clean', focal: 35, aperture: 'f/4' };

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
    // Shot size for FRAMING (block mode): a Shot size setting or the storyboard's; else from the focal.
    shot: shotOf(idOf(raw.shot)),
  };
  return out.on || out.filter || out.era || out.light || out.palette || out.genre || out.move || out.shot ? out : null;
}

// "Unusual" combinations: not an error — advice (it may look great or odd).
// Each piece names the block it is about (package 04, §2.5: an amber dot on that
// block, the text inside its panel): camera or move.
export function lookAdvice(look, { kind = 'video', aspect = null, size = null } = {}) {
  const l = look || {};
  const out = [];
  const add = (block, h) => out.push({ block, text: `${h} Not typical in real shooting — the result can be great or odd. Experiment!` });
  const lens = byId(LENSES, l.lens);
  const camera = byId(CAMERAS, l.camera);
  const ap = APERTURES.find((a) => a.f === l.aperture);
  if (l.on !== false && lens?.focal && l.focal && (l.focal < lens.focal[0] || l.focal > lens.focal[1])) {
    add('camera', `${lens.label} lenses are usually ${lens.focal[0]}–${lens.focal[1]} mm.`);
  }
  if (l.on !== false && lens?.maxAperture && ap && ap.n > lens.maxAperture) add('camera', `${lens.label} swirl shows only wide open (f/${lens.maxAperture} or wider).`);
  if (l.on !== false && lens?.id === 'macro' && ap && ap.n < 5.6) add('camera', 'Real macro is shot at f/8–f/16 — wide open only a sliver is sharp.');
  if (l.on !== false && camera?.sensor === 'small' && ap && ap.n <= 2) add('camera', `${camera.label} rarely gives strong background blur, even at ${ap.f}.`);
  if (l.on !== false && l.focal && l.focal <= 16 && /close-up/.test(String(size || ''))) add('camera', 'Very wide lenses distort faces in close-ups.');
  if (l.on !== false && lens?.wide && /^9:16|^3:4|^4:5/.test(String(aspect || ''))) add('camera', 'Anamorphic is a widescreen look; a vertical frame crops it.');
  if (kind === 'video' && l.move === 'zoom-in' && byId(LENSES, l.lens) && !['vintage-zoom'].includes(l.lens) && l.on !== false) add('move', 'Prime lenses can’t zoom — the model may treat it as a push-in.');
  return out;
}
export function lookHints(look, opts = {}) {
  return lookAdvice(look, opts).map((a) => a.text);
}

// Data the studio needs to draw the controls (labels and ranges, no prompt words).
// `framing`: some model's memo turns FRAMING on (block mode); only then the panel shows
// "85mm → head and shoulders" (held until the place-anchor question is answered, docs/ux/45).
export function lookForClient({ framing = false } = {}) {
  const pick = (list, keys) => list.map((x) => Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]])));
  return {
    cameras: pick(CAMERAS.filter((c) => !c.hidden), ['id', 'label', 'note', 'sensor', 'texture']),
    lenses: pick(LENSES, ['id', 'label', 'note', 'focal', 'maxAperture', 'wide']),
    filters: pick(FILTERS, ['id', 'label', 'note']),
    focals: FOCALS.map((f) => f.mm),
    // "85 mm → head and shoulders" in the Look panel (block mode, doc 44 §C).
    focalShots: framing ? Object.fromEntries(Object.entries(FOCAL_SHOT).map(([mm, id]) => [mm, SHOTS.find((x) => x.id === id).label])) : {},
    apertures: APERTURES.map((a) => a.f),
    eras: pick(ERAS, ['id', 'label']),
    lights: pick(LIGHTS, ['id', 'label']),
    palettes: pick(PALETTES, ['id', 'label']),
    genres: pick(GENRES, ['id', 'label']),
    moves: pick(MOVES, ['id', 'label']),
    defaults: DEFAULT_LOOK,
  };
}

// The words: lens, focal, aperture, filter (the camera itself has its own words,
// cameraLines below), move, light, era. `framed` (a video from a start frame):
// no lens, focal, aperture or filter words at all (§4, rule 1).
const CLOSER = new Set(['dolly-in', 'push-in', 'zoom-in']);
function words(look, kind, { framed = false, family = null } = {}) {
  const lens = byId(LENSES, look.lens);
  const focal = FOCALS.find((f) => f.mm === look.focal);
  const ap = APERTURES.find((a) => a.f === look.aperture);
  const filter = byId(FILTERS, look.filter);
  const cam = look.on && !framed ? [
    lens ? lens.text : '',
    focal ? `${focal.mm}mm (${focal.text})` : '',
    ap ? `${ap.f} (${ap.text})` : '',
  ].filter(Boolean) : [];
  if (filter && !framed) cam.push(filter.text);
  // Kling from a start frame: "push-in" alone moves far too much (§7).
  let move = kind === 'video' ? byId(MOVES, look.move)?.text || '' : '';
  if (move && framed && family === 'kling' && CLOSER.has(look.move)) move = 'very slight slow move closer';
  return {
    camera: cam.join(', '),
    move,
    light: byId(LIGHTS, look.light)?.text || '',
    palette: byId(PALETTES, look.palette)?.text || '',
    genre: byId(GENRES, look.genre)?.text || '',
    era: byId(ERAS, look.era)?.text || '',
  };
}

// The camera's own words, in the model's template (§7), when there is no start frame.
// → { lead, lines: [[label, text]], header: [label, text], sentence }:
//   lead      a sentence right after Wan's "Generate single shot." (else first);
//   lines     "Label: text" lines (Kling Visual style / Camera tone, Wan Style);
//   header    Seedance's "[Overall style] …" block;
//   sentence  any other model: one sentence where its camera words go.
const fillLine = (ratio, corners) => `The picture fills the whole ${/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(ratio || '')) ? `${ratio} ` : ''}frame edge to edge, no black bars, no border${corners ? ', square corners' : ''}.`;
const dot = (t) => (t ? `${cap(t.replace(/[.\s]+$/, ''))}.` : '');
export function cameraLines(look, { kind = 'video', family = null, ratio = null } = {}) {
  const c = look && look.on !== false ? cameraOf(look.camera) : null;
  if (!c?.shot) return null;
  const keep = c.keep ? dot(c.keep) : '';
  // Phone in a video: the handheld behaviour and "no device in the picture" go with the look (§7).
  const extra = kind === 'video' && c.behaviour ? dot(c.behaviour) : '';
  if (kind === 'video' && family === 'kling') {
    if (c.kling) return { lines: [['Visual style', [c.kling.replace('{orient}', String(ratio) === '16:9' ? 'horizontal ' : ''), extra, dot(c.klingOnly)].filter(Boolean).join(' ')]] };
    if (c.toneOnly) return { lines: [['Camera tone', dot(c.look)]] };
    return { lines: [['Visual style', dot(c.shot)], ['Camera tone', [dot(c.look), keep].filter(Boolean).join(' ')]] };
  }
  if (kind === 'video' && family === 'seedance') return { header: ['[Overall style]', [dot(c.shot), dot(c.look), extra, keep, fillLine(ratio, true)].filter(Boolean).join(' ')] };
  if (kind === 'video' && family === 'wan') return { lead: dot(c.shot), lines: [['Style', [dot(c.look), extra, keep, fillLine(ratio, false)].filter(Boolean).join(' ')]] };
  return { sentence: [dot(`${c.shot}: ${c.look}`), extra, keep].filter(Boolean).join(' ') };
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

// ── Re-shoot a frame with the chosen camera (handoff 17, §5) ─────────────────
// One picture in, the same scene out, through the chosen camera, lens and aperture.
// Lens and aperture: only the wording tested in the re-shoot round, and only when
// that lens or aperture is chosen (the controls themselves are unchanged).
// Never dust, scratches, hairs, light leaks, tracking bands or timestamps: the video
// model turns them into real objects; the filter adds them (§5, hard rule).
const RESHOOT_LENS = { anamorphic: true, 'vintage-anamorphic': true };
const RESHOOT_ANAMORPHIC = 'Long thin horizontal blue lens flares stretch sideways from small light sources; faces stay clear of flares. Out-of-focus background lights are vertical ovals';
// Phone (§5.1): not a re-shoot — the frame is shrunk to 70 % on a grey canvas (canvas.js) and the
// image model fills the grey around it. The prompt is the same for every scene; only the ratio changes.
// Lens and aperture are ignored here: the extension keeps the look of the source.
export const CANVAS_SCALE = 0.7;
export function canvasPrompt({ ratio = null, ref = '@img1' } = {}) {
  const shape = /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(ratio || '')) ? `${ratio} ` : '';
  return `${ref} is a photo placed in the middle of a larger plain grey canvas. Fill the grey area by extending the photo outward so the result is one seamless photo of the same place seen from further back, with more of the scene visible on all four sides. Do not change the photo in the middle: everything in it stays exactly as it is, at the same size and position. No grey left, no visible seam, no frame or border. Same light, colours and sharpness everywhere. The picture fills the whole ${shape}frame.`;
}
export const isCanvasCamera = (look) => look?.on !== false && cameraOf(look?.camera)?.id === 'phone';

export function reshootPrompt(look, { ratio = null, ref = '@img1', subject = null } = {}) {
  if (isCanvasCamera(look)) return canvasPrompt({ ratio, ref });
  const c = look && look.on !== false ? cameraOf(look.camera) : null;
  const ap = APERTURES.find((a) => a.f === look?.aperture);
  const lens = look?.on !== false && RESHOOT_LENS[look?.lens];
  const camera = [c?.reshoot?.camera, lens ? 'through an anamorphic lens' : ''].filter(Boolean).join(' ');
  const looks = [c?.reshoot?.look, lens ? RESHOOT_ANAMORPHIC : '',
    look?.on !== false && ap && ap.n <= 2.8 ? 'Shallow depth of field, the background softly blurred' : '',
    look?.on !== false && ap && ap.n >= 8 ? 'Everything is sharp from the nearest object to the far background; no background blur at all' : ''].filter(Boolean);
  if (!camera && !looks.length) return null;
  const same = subject ? `the same ${subject}` : 'the same people, clothes, objects and place, same faces';
  const shape = /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(ratio || '')) ? `${ratio} ` : '';
  return `Re-shoot the scene in ${ref}${camera ? ` ${camera}` : ''}: ${same}, same moment and pose. ${looks.map(dot).join(' ')} The picture fills the whole ${shape}frame, no black bars, no border.`;
}

// opts.framed: a video made from a start frame (§4): no camera, lens or aperture
// words; KEEP_FRAME instead. opts.ratio: the ratio sent (for the fill-frame line).
export function renderLook(prompt, look, { kind = 'video', memo = null, framed = false, ratio = null } = {}) {
  const raw = String(prompt ?? '');
  if (!look) return raw;
  const family = memo?.id || null;
  const fromFrame = kind === 'video' && framed;
  const w = words(look, kind, { framed: fromFrame, family });
  const camText = fromFrame ? null : cameraLines(look, { kind, family, ratio });
  // Any look with a start frame (camera, lens, move, light…): the frame decides the picture.
  const keepLine = fromFrame ? KEEP_FRAME : '';
  // Phone from a start frame (doc 42, answer 1): only the handheld behaviour line, no look
  // words. It describes motion; without it the clip stands still like a tripod shot.
  const cam = look.on !== false ? cameraOf(look.camera) : null;
  const motionLine = fromFrame && cam?.behaviour ? dot(cam.behaviour) : '';
  const parts = [w.camera, w.move, w.light, w.palette, w.genre, w.era, keepLine, camText, look.shot];
  if (!parts.some(Boolean)) return raw;
  const camOne = camText ? [camText.lead, camText.header?.[1], ...(camText.lines || []).map(([, t]) => t), camText.sentence].filter(Boolean).join(' ') : '';

  const rule = memo?.look || {};
  // A JSON prompt stays JSON: the look goes into the model's own keys (its
  // camera / style blocks, any letter case), added to what is already there.
  const text = raw.trim();
  if (/^[{[]/.test(text)) {
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value) || !value || typeof value !== 'object') return raw; // a list has no place for keys
      const out = { ...value };
      const labeledJson = rule.place === 'labeled' && kind === 'video';
      const put = (name, t) => {
        if (!t) return;
        const k = Object.keys(out).find((x) => x.toLowerCase() === name.toLowerCase());
        if (k === undefined) out[name.toLowerCase()] = t;
        else if (typeof out[k] === 'string') out[k] = out[k].trim() ? `${out[k].trim().replace(/[.;,\s]+$/, '')}; ${t}` : t;
        else if (Array.isArray(out[k])) out[k] = [...out[k], t];
        else if (out[k] && typeof out[k] === 'object') out[k] = { ...out[k], look: [out[k].look, t].filter((x) => typeof x === 'string' && x).join('; ') };
        else out[k] = t;
      };
      // Block mode (Kling, Seedance): the same blocks as for plain text, as keys; no "lens", no mm.
      if (labeledJson) {
        const blocks = lookBlocks(look, { family, framing: rule.framing, framed: fromFrame, ratio, words: w, motionLine });
        const hasFraming = Object.keys(out).some((x) => x.toLowerCase() === 'framing');
        // Their own framing or camera: the "hold the close framing" line could contradict it.
        const hasCamera = Object.keys(value).some((x) => x.toLowerCase() === 'camera');
        if ((hasFraming || hasCamera) && blocks.CAMERA) blocks.CAMERA = blocks.CAMERA.replace(HOLD_CLOSE, '').replace(/\s{2,}/g, ' ').trim();
        for (const label of BLOCK_ORDER) if (blocks[label] && !(label === 'FRAMING' && hasFraming)) put(label.toLowerCase(), blocks[label]);
        // Phone from a start frame (docs/ux/46 §7): a new camera key goes first, before the user's keys.
        const camKey = Object.keys(out).find((x) => x.toLowerCase() === 'camera');
        if (fromFrame && blocks.CAMERA?.startsWith('Handheld.') && camKey && !Object.keys(value).some((x) => x.toLowerCase() === 'camera')) {
          const { [camKey]: cam, ...rest } = out;
          return JSON.stringify({ [camKey]: cam, ...rest }, null, 2);
        }
        return JSON.stringify(out, null, 2);
      }
      if (rule.camera) put(rule.camera, [camOne, w.camera, w.move].filter(Boolean).join(', '));
      else { put('camera', [camOne, w.camera].filter(Boolean).join(' ')); put('camera_movement', w.move); }
      if (rule.style) put(rule.style, [w.light, w.palette, w.genre, w.era].filter(Boolean).join(', '));
      else { put('lighting', w.light); put('color', w.palette); put('genre', w.genre); put('era', w.era); }
      put(rule.camera || 'camera_movement', motionLine);
      put('keep', keepLine);
      return JSON.stringify(out, null, 2);
    } catch { /* not JSON after all: plain text */ }
  }

  // Block mode (Kling, Seedance): the user's text as it is, the look in labelled blocks below.
  if (rule.place === 'labeled' && kind === 'video') return labeledLook(text, look, { family, framing: rule.framing, framed: fromFrame, ratio, words: w, motionLine });

  let out = camText ? placeCamera(text, camText) : text;
  // Any other model: the camera's sentence goes where its camera words go, before the lens and move.
  out = placeRest(out, w, rule, camText?.sentence || '');
  if (motionLine) out = `${out.replace(/\s+$/, '')}${out.trim() ? '\n' : ''}${motionLine}`;
  if (keepLine) out = `${out.replace(/\s+$/, '')}${out.trim() ? '\n' : ''}${keepLine}`;
  return out;
}

// The camera's own words (cameraLines) into the prompt.
function placeCamera(text, cam) {
  let out = text;
  if (cam.header) {
    const [label, t] = cam.header;
    const re = new RegExp(`^(\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(.*)$`, 'im');
    out = re.test(out) ? out.replace(re, (_, head, rest) => `${head}${rest.replace(/[.\s]*$/, '')}${rest.trim() ? '. ' : ' '}${t}`) : `${label} ${t}${out.trim() ? '\n' : ''}${out}`;
  }
  if (cam.lead) {
    // Wan (§7): "Generate single shot. <camera>." — a multi-shot prompt ("Shot 1 [0–3s]…") gets the camera first.
    const re = /(generate single shot\.)/i;
    if (re.test(out)) out = out.replace(re, `$1 ${cam.lead}`);
    else if (/\bshot\s*\d/i.test(out)) out = `${cam.lead}${out.trim() ? ' ' : ''}${out}`;
    else out = `Generate single shot. ${cam.lead}${out.trim() ? ' ' : ''}${out}`;
  }
  for (const [label, t] of cam.lines || []) out = intoBlock(out, label, t.replace(/\.$/, ''));
  return out;
}

const hasLabel = (text, label) => Boolean(label) && new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'im').test(text);

// Lens, focal, aperture, filter, move, light, palette, genre and era, as before.
function placeRest(text, w, rule, camSentence = '') {
  if (![camSentence, w.camera, w.move, w.light, w.palette, w.genre, w.era].some(Boolean)) return text;
  // A prompt already written in the model's labeled blocks (e.g. by "Adapt to
  // model"): the look joins those blocks, whatever the model's usual place.
  if (rule.place === 'blocks' || hasLabel(text, rule.camera) || hasLabel(text, rule.style)) {
    const camLabel = rule.camera || 'Camera';
    const styleLabel = rule.style || camLabel;
    let out = text;
    out = intoBlock(out, camLabel, [camSentence.replace(/\.$/, ''), [w.camera, w.move].filter(Boolean).join(', ')].filter(Boolean).join('; '));
    out = intoBlock(out, styleLabel, [w.light, w.palette, w.genre, w.era].filter(Boolean).join(', '));
    return out;
  }
  const cameraSentence = [camSentence, sentence([w.camera, w.move].filter(Boolean).join(', '))].filter(Boolean).join(' ');
  const styleSentence = [sentence(w.light && `lighting: ${w.light}`), sentence(w.palette && `color: ${w.palette}`), sentence(w.genre), sentence(w.era)].filter(Boolean).join(' ');
  const body = text ? (/[.!?"')\]]$/.test(text) ? text : `${text.replace(/[,;:\s]+$/, '')}.`) : '';
  if (rule.place === 'start') return [cameraSentence, body, styleSentence].filter(Boolean).join(' ');
  return [body, cameraSentence, styleSentence].filter(Boolean).join(' ');
}

// ── Block mode (docs/ux/43 §3, 44 §C) ─────────────────────────────────────────
// Kling and Seedance: the user's paragraph stays as it is; the look goes below it in
// labelled blocks, in this order. A block the prompt already has (a line starting with
// the label in capitals, or the label and a colon) gets the words added to it instead.
// Never a mm value or the word "lens" in our words (doc 42, answer 3): film gauges
// ("35mm film") name the camera, not a focal length, and stay.
export const BLOCK_ORDER = ['FRAMING', 'FOCUS', 'CAMERA', 'STYLE', 'TECH'];
// A start frame (§4): the frame decides the picture; keep it, without the word "lens".
export const KEEP_FRAME_BLOCKS = 'Keep the focus, colour and image texture of the first frame unchanged for the whole clip.';
function noLens(t) {
  return String(t || '')
    .replace(/\b(wide-angle phone) lens\b/gi, '$1 camera')
    .replace(/\s+with a spherical cinema lens\b/gi, '')
    .replace(/\blens flares?\b/gi, (m) => m.replace(/lens /i, ''))
    .replace(/\b\d+\s?mm\s+(?:lens|focal length)\b/gi, '')
    .replace(/\blens(es)?\b/gi, 'camera')
    .replace(/\s{2,}/g, ' ').trim();
}
const join = (...xs) => xs.map((x) => dot(x)).filter(Boolean).join(' ');

export function lookBlocks(look, { family = null, framing = false, framed = false, ratio = null, words: w = null, motionLine = '' } = {}) {
  const b = Object.fromEntries(BLOCK_ORDER.map((k) => [k, []]));
  const on = look.on !== false;
  const cam = on ? cameraOf(look.camera) : null;
  if (framed) {
    // Only the move, the Phone line and the keep line (doc 43 §3.5). Phone (docs/ux/46 §7, Denis's
    // pick P1 from stage 17): what is seen in the picture, as a CAMERA block placed first.
    b.CAMERA.push(motionLine ? PHONE_FROM_FRAME : '', w?.move);
    b.TECH.push(KEEP_FRAME_BLOCKS);
  } else {
    const shot = look.shot || (on && look.focal ? FOCAL_SHOT[look.focal] : null);
    if (framing && shot) b.FRAMING.push(SHOTS.find((x) => x.id === shot)?.framing);
    // Close shots (docs/ux/46 §9, stages 21–22): Kling otherwise pulls back during the clip (T4a: −44 %).
    // Not with a camera move: it would contradict it.
    if (framing && (shot === 'face' || shot === 'head-shoulders') && (!look.move || look.move === 'static')) b.CAMERA.push(HOLD_CLOSE);
    const ap = on ? APERTURES.find((a) => a.f === look.aperture) : null;
    if (ap) b.FOCUS.push(FOCUS_STEPS.find((s) => ap.n <= s.max).text);
    b.CAMERA.push(w?.move);
    if (cam?.behaviour) b.CAMERA.push(cam.behaviour);
    if (cam?.shot) {
      if (family === 'kling' && cam.kling) b.TECH.push(cam.kling.replace('{orient}', String(ratio) === '16:9' ? 'horizontal ' : ''), cam.klingOnly);
      else if (family === 'kling' && cam.toneOnly) b.STYLE.push(cam.look);
      else {
        b.TECH.push(cam.shot);
        b.STYLE.push(cam.look, cam.keep);
      }
      if (family === 'seedance') b.TECH.push(fillLine(ratio, true));
    }
    const lens = on ? byId(LENSES, look.lens) : null;
    const filter = byId(FILTERS, look.filter);
    b.STYLE.push(lens?.effect, filter?.text, w?.light, w?.palette, w?.genre, w?.era);
  }
  return Object.fromEntries(Object.entries(b).map(([k, xs]) => [k, noLens(join(...xs.filter(Boolean)))]).filter(([, t]) => t));
}

// Phone from a start frame (docs/ux/46 §7). Stage 17: a CAMERA block at the start describing what is
// seen moved the picture 42 px over 4 s (light shake, jitter 0.5 px RMS); the line at the end, 5 px.
// The tested P1 also named where the person stands and a drift to the right; this general form is untested.
export const PHONE_FROM_FRAME = 'Handheld. The video is filmed on a phone held in one hand. The whole picture shakes slightly all the time: small quick jitters up, down, left and right. The frame is never still, and the horizon tilts a little to the left and to the right. No phone or other device is visible in the picture.';

function labeledLook(text, look, opts) {
  const blocks = lookBlocks(look, opts);
  let out = String(text || '').replace(/\s+$/, '');
  const extra = [];
  // The user's own CAMERA block (e.g. "Slow dolly out"): our "never moves back" line could contradict it.
  if (blocks.CAMERA && intoLabeledBlock(out, 'CAMERA', '') !== null) blocks.CAMERA = blocks.CAMERA.replace(HOLD_CLOSE, '').replace(/\s{2,}/g, ' ').trim();
  // From a start frame with Phone: CAMERA goes first (before the user's text) unless the user has one.
  if (opts.framed && blocks.CAMERA?.startsWith('Handheld.') && intoLabeledBlock(out, 'CAMERA', '') === null) {
    out = `CAMERA ${blocks.CAMERA}${out ? `\n\n${out}` : ''}`;
    delete blocks.CAMERA;
  }
  for (const label of BLOCK_ORDER) {
    const t = blocks[label];
    if (!t) continue;
    // The user's own FRAMING wins: two shot sizes in one block contradict each other.
    if (label === 'FRAMING' && intoLabeledBlock(out, label, '') !== null) {
      // Their framing, not ours: the "hold the close framing" line was for ours.
      if (blocks.CAMERA) blocks.CAMERA = blocks.CAMERA.replace(HOLD_CLOSE, '').replace(/\s{2,}/g, ' ').trim();
      continue;
    }
    const merged = intoLabeledBlock(out, label, t);
    if (merged === null) extra.push(`${label} ${t}`);
    else out = merged;
  }
  return extra.length ? `${out}${out ? '\n\n' : ''}${extra.join('\n\n')}` : out;
}

// Adds `t` to the end of the user's own block (`LABEL text…` up to the next blank line or
// the next capitalised label), or returns null when the prompt has no such block.
// Block names the memos and Adapt write ("Camera:", "[Overall style]"…): a line starting with
// one ends the block before it. Other "Word:" lines ("Note: she smiles") stay inside it.
const BLOCK_NAME = /^\s*(?:\[[A-Za-z ]{3,30}\]|(?:references?|subject|action|scene|style|camera|sound|audio|beats|look|lighting|light|mood|dialogue|objects|background|focus|framing|tech|visual style|camera tone|overall style|shot \d+)\s*:)/i;
function intoLabeledBlock(text, label, t) {
  const lines = text.split('\n');
  const head = new RegExp(`^\\s*(?:${label}\\b(?!-)|${label}\\s*:)`, 'i');
  const exact = new RegExp(`^\\s*(?:${label}\\b(?!-)|${label[0]}${label.slice(1).toLowerCase()}\\s*:)`);
  const at = lines.findIndex((l) => exact.test(l) || (head.test(l) && /:/.test(l.slice(0, label.length + 3))));
  if (at < 0) return null;
  let end = at;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (!lines[i].trim() || /^\s*[A-Z]{3,}\b(?:\s|:|$)/.test(lines[i]) || BLOCK_NAME.test(lines[i])) break;
    end = i;
  }
  const line = lines[end].replace(/\s+$/, '');
  const onLabelOnly = end === at && new RegExp(`^\\s*${label}\\s*:?$`, 'i').test(line);
  lines[end] = onLabelOnly ? `${line} ${t}` : `${/[.!?]$/.test(line) ? line : `${line}.`} ${t}`;
  return lines.join('\n');
}
