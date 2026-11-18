// DZ: logic of the unified Create studio — no React here.
//
// The interface is built from what each model accepts at each provider. The
// gateway already turns every provider's own description (Atlas JSON schema,
// APIMart parameters, overrides) into `model.inputs`; this module reads those
// inputs and works out:
//   • media slots by role (first / middle / last frame, reference images,
//     reference videos, a video to edit, audio) with their limits;
//   • parameters: the main ones (shown in the bar) and the rest (Advanced);
//   • how the prompt refers to references (@image_1 for Kling, @Image1 for
//     Seedance), when the provider documents it;
//   • which of a model's endpoints to call for the media actually attached.

const LISTS = { image: ["t2i", "i2i"], video: ["t2v", "i2v", "v2v"] };
const MODE_ORDER = { t2i: 0, i2i: 1, t2v: 0, i2v: 1, v2v: 2 };

// ── Media roles ─────────────────────────────────────────────────────────────

export const ROLE_INFO = {
  first: { label: "Start frame", kind: "image" },
  middle: { label: "Middle frames", kind: "image" },
  last: { label: "End frame", kind: "image" },
  reference: { label: "References", kind: "image" },
  video: { label: "Reference videos", kind: "video" },
  source: { label: "Video to edit", kind: "video" },
  audio: { label: "Audio", kind: "audio" },
};
export const ROLE_ORDER = ["first", "middle", "last", "reference", "video", "source", "audio"];

const FIRST = /^(first_frame|first_frame_image|start_image|start_frame|start_image_url|first_frame_url)$/;
const LAST = /^(last_image|last_frame|last_frame_image|end_image|end_frame|tail_image|last_frame_url|end_image_url)$/;
const MIDDLE = /^(middle_images|middle_frames)$/;
const VIDEO_REF = /^(reference_videos|reference_video|video_refs)$/;

function roleOf(name, input, kind) {
  if (input.field === "image") {
    if (LAST.test(name)) return "last";
    if (MIDDLE.test(name)) return "middle";
    if (FIRST.test(name)) return "first";
    // A single `image` on a video model is its start frame; on an image model
    // (and arrays anywhere) images are references / sources to edit.
    if (kind === "video" && input.type !== "array" && /^(image|image_url|img|input_image)$/.test(name)) return "first";
    return "reference";
  }
  if (input.field === "video") return VIDEO_REF.test(name) ? "video" : "source";
  if (input.field === "audio") return "audio";
  return null;
}

// Media fields of one variant: role → { field, max, array }.
export function mediaOf(model, kind) {
  const out = {};
  for (const [name, input] of Object.entries(model.inputs || {})) {
    const role = roleOf(name, input, kind);
    if (!role || out[role]) continue;
    const array = input.type === "array";
    out[role] = { field: name, array, max: array ? (input.maxItems || (role === "reference" ? Number(model.maxImages) || 4 : 4)) : 1 };
  }
  return out;
}

// ── Parameters ─────────────────────────────────────────────────────────────

const MAIN = ["aspect_ratio", "ratio", "size", "image_size", "resolution", "quality", "duration", "num_images", "n", "batch_size"];
const SKIP = new Set(["prompt", "seed_image"]);

// Non-media inputs of a variant: { main: [...], advanced: [...] } in a stable order.
export function paramsOf(model) {
  const all = [];
  for (const [name, input] of Object.entries(model.inputs || {})) {
    if (input.field || SKIP.has(name) || input.type === "array") continue;
    all.push({ ...input, key: name });
  }
  const main = MAIN.map((k) => all.find((p) => p.key === k)).filter(Boolean);
  const advanced = all.filter((p) => !main.includes(p));
  return { main, advanced };
}

// How the prompt refers to attached references, from the provider's own text.
export function refSyntaxOf(model) {
  // An explicit hint from the catalog (provider overrides) wins over the text.
  const hint = model.dzRefSyntax;
  const d = String(model.inputs?.prompt?.description || "");
  if (hint === "image_N" || /@image_N|@image_\d/.test(d)) return { image: (n) => `@image_${n}`, video: (n) => `@video_${n}`, audio: (n) => `@audio_${n}` };
  if (hint === "ImageN" || /@Image(\d|N)/.test(d)) return { image: (n) => `@Image${n}`, video: (n) => `@Video${n}`, audio: (n) => `@Audio${n}` };
  if (hint === "imageN" || /@image(\d|N)\b/.test(d)) return { image: (n) => `@image${n}`, video: (n) => `@video${n}`, audio: (n) => `@audio${n}` };
  return null;
}

// Same model at another provider: its docs usually spell out the @-syntax
// (it belongs to the model, the provider passes the prompt through).
export function refSyntaxFor(model) {
  const own = refSyntaxOf(model);
  if (own || !model?.dzFamily) return own;
  const lists = (typeof window !== "undefined" && window.__DZ_CATALOG__?.lists) || {};
  for (const list of Object.values(lists)) {
    for (const m of list || []) if (m?.dzFamily === model.dzFamily && m !== model) { const s = refSyntaxOf(m); if (s) return s; }
  }
  return null;
}

// ── Model entries: one per family + provider ───────────────────────────────

// Every variant (endpoint) of one model at one provider, for Image or Video.
export function createEntries(kind) {
  const lists = (typeof window !== "undefined" && window.__DZ_CATALOG__?.lists) || {};
  const byKey = new Map();
  for (const mode of LISTS[kind]) {
    for (const model of lists[mode] || []) {
      if (!model?.endpoint || !model.dzFamily) continue;
      const key = `${model.dzFamily}|${model.dzProvider}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          kind,
          family: model.dzFamily,
          familyName: model.dzFamilyName || model.name,
          provider: model.dzProvider,
          providerName: model.dzProviderName,
          vendorName: model.provider_name,
          logo: model.dzLogo,
          vendorLogo: model.dzVendorLogo,
          recommended: model.dzRecommended,
          variants: [],
        });
      }
      const entry = byKey.get(key);
      if (entry.variants.some((v) => v.model.endpoint === model.endpoint)) continue;
      entry.variants.push({ mode, model, media: mediaOf(model, kind) });
      if (model.dzRecommended != null && (entry.recommended == null || model.dzRecommended < entry.recommended)) entry.recommended = model.dzRecommended;
    }
  }
  for (const entry of byKey.values()) {
    entry.variants.sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode]);
    // Price label of the cheapest variant ("$0.11/s", "from $0.13/s").
    entry.priceLabel = entry.variants.map((v) => v.model.dzPrice?.label).find(Boolean) || "";
    // Every slot any of its endpoints accepts, with the largest limit.
    const slots = {};
    for (const v of entry.variants) {
      for (const [role, m] of Object.entries(v.media)) {
        if (!slots[role] || slots[role].max < m.max) slots[role] = { role, max: m.max };
      }
    }
    entry.slots = ROLE_ORDER.filter((r) => slots[r]).map((r) => slots[r]);
    entry.textOnly = entry.variants.some((v) => Object.keys(v.media).length === 0 && v.model.hasPrompt !== false);
  }
  return [...byKey.values()].sort((a, b) => (a.recommended ?? 1e9) - (b.recommended ?? 1e9) || a.familyName.localeCompare(b.familyName));
}

// ── Elements ─────────────────────────────────────────────────────────────
// Kling-style models take elements natively (`elements`: name + front image +
// more images, or a person video). Every other model gets an element's
// pictures as references (and its video as a video reference, if it takes one).

export const elementsInputOf = (model) => (model?.inputs?.elements?.type === "elements" ? model.inputs.elements : null);
export const entryTakesElements = (entry) => Boolean(entry?.variants.some((v) => elementsInputOf(v.model)));

// The files an element adds when the model has no native elements.
export function elementMedia(entry, elements = []) {
  const has = (r) => entry?.slots.some((s) => s.role === r);
  const out = {};
  if (has("reference")) out.reference = elements.flatMap((e) => (e.images || []).slice(0, 3).map((url) => ({ url, name: e.name, element: e.id })));
  if (has("video")) {
    const videos = elements.filter((e) => e.video).map((e) => ({ url: e.video, name: e.name, element: e.id }));
    if (videos.length) out.video = videos;
  }
  return out;
}

// Attached files + elements → what the endpoint choice and the body use.
export function mergeElements(entry, attached, elements = []) {
  if (!elements.length) return { attached, native: false };
  if (entryTakesElements(entry)) return { attached, native: true };
  const extra = elementMedia(entry, elements);
  const merged = { ...attached };
  for (const [role, files] of Object.entries(extra)) merged[role] = [...(attached[role] || []), ...files];
  return { attached: merged, native: false };
}

// One element in Kling's shape.
export function klingElement(e, spec, { allowVideo }) {
  const name = String(e.name || "Element").slice(0, spec.nameMax || 20);
  const description = String(e.description || "").slice(0, spec.descMax || 100) || undefined;
  if (allowVideo && e.video && e.kind === "character") {
    return { element_name: name, element_description: description, reference_type: "video_refer", refer_videos: [e.video] };
  }
  const images = e.images || [];
  if (!images.length) return null;
  const refs = images.slice(1, 1 + (spec.refMax || 3));
  return { element_name: name, element_description: description, reference_type: "image_refer", frontal_image: images[0], refer_images: refs.length ? refs : [images[0]] };
}

// [{ element, kling }] in the order sent — prompt tags (@element_N) follow it.
export function klingElementPairs(elements, spec) {
  let videos = 0;
  const out = [];
  for (const e of elements) {
    if (out.length >= (spec.maxItems || 7)) break;
    const allowVideo = videos < (spec.maxVideo || 0);
    const k = klingElement(e, spec, { allowVideo });
    if (!k) continue;
    if (k.reference_type === "video_refer") videos += 1;
    out.push({ element: e, kling: Object.fromEntries(Object.entries(k).filter(([, v]) => v !== undefined)) });
  }
  return out;
}
export const klingElements = (elements, spec) => klingElementPairs(elements, spec).map((p) => p.kling);

// The endpoint to call for what is attached. Prefers the simplest endpoint
// that accepts every attached role and has room for every file.
export function chooseVariant(entry, attached, { native = false } = {}) {
  if (native) {
    const own = { ...entry, variants: entry.variants.filter((v) => elementsInputOf(v.model)) };
    if (own.variants.length) return chooseVariant(own, attached);
  }
  const used = Object.entries(attached).filter(([, files]) => files.length).map(([role]) => role);
  const fits = entry.variants.filter((v) => used.every((role) => v.media[role] && attached[role].length <= v.media[role].max));
  if (!fits.length) return null;
  // Text-only request: an endpoint that needs no media at all, if there is one.
  if (!used.length) {
    const plain = fits.find((v) => Object.keys(v.media).length === 0 || !(v.model.required || []).some((f) => v.model.inputs?.[f]?.field));
    if (plain) return plain;
  }
  // Prefer endpoints whose required media are all attached, then the simplest one.
  const score = (v) => (missingFor(v, attached) ? 1000 : 0) + Object.keys(v.media).length;
  return [...fits].sort((a, b) => score(a) - score(b))[0];
}

// What is missing for the chosen endpoint (required media) — null when ready.
export function missingFor(variant, attached) {
  if (!variant) return null;
  for (const field of variant.model.required || []) {
    const input = variant.model.inputs?.[field];
    if (!input?.field) continue;
    const role = Object.entries(variant.media).find(([, m]) => m.field === field)?.[0];
    if (role && !(attached[role] || []).length) return `${ROLE_INFO[role].label} is required for this model.`;
  }
  return null;
}

// Request body for the chosen endpoint.
export function buildBody(variant, { prompt, values, attached, noDefault = [], elements = [] }) {
  const body = {};
  if (variant.model.hasPrompt !== false && prompt) body.prompt = prompt;
  const { main, advanced } = paramsOf(variant.model);
  for (const p of [...main, ...advanced]) {
    const v = values[p.key];
    if (v !== undefined && v !== null && v !== "") body[p.key] = coerce(p, v);
    else if (!noDefault.includes(p.key) && p.default !== undefined && p.default !== null && p.default !== "") body[p.key] = p.default;
  }
  for (const [role, m] of Object.entries(variant.media)) {
    const files = (attached[role] || []).map((f) => f.url).filter(Boolean);
    if (!files.length) continue;
    body[m.field] = m.array ? files.slice(0, m.max) : files[0];
  }
  const spec = elementsInputOf(variant.model);
  if (spec && elements.length) {
    const list = klingElements(elements, spec);
    if (list.length) body.elements = list;
  }
  return body;
}

function coerce(p, v) {
  if (p.type === "int") return Math.round(Number(v));
  if (p.type === "number") return Number(v);
  if (p.type === "boolean") return v === true || v === "true";
  return v;
}

// Values carried over when the model changes: keep only those the new
// endpoint accepts (and that are allowed values there).
export function keepValues(values, variant) {
  if (!variant) return values;
  const out = {};
  const { main, advanced } = paramsOf(variant.model);
  for (const p of [...main, ...advanced]) {
    const v = values[p.key];
    if (v === undefined) continue;
    if (Array.isArray(p.enum) && !p.enum.map(String).includes(String(v))) continue;
    out[p.key] = v;
  }
  return out;
}

// ── Camera (from Cinema) and camera moves ──────────────────────────────────

export const CAMERA = {
  "Modular 8K Digital": "modular 8K digital cinema camera",
  "Full-Frame Cine Digital": "full-frame digital cinema camera",
  "Grand Format 70mm Film": "grand format 70mm film camera",
  "Studio Digital S35": "Super 35 studio digital camera",
  "Classic 16mm Film": "classic 16mm film camera",
  "Premium Large Format Digital": "premium large-format digital cinema camera",
};
export const LENS = {
  "Premium Modern Prime": "premium modern prime lens",
  "Classic Anamorphic": "classic anamorphic lens",
  "Compact Anamorphic": "compact anamorphic lens",
  "70s Cinema Prime": "1970s cinema prime lens",
  "Warm Cinema Prime": "warm-toned cinema prime lens",
  "Vintage Prime": "vintage prime lens",
  "Swirl Bokeh Portrait": "swirl bokeh portrait lens",
  "Clinical Sharp Prime": "ultra-sharp clinical prime lens",
  "Halation Diffusion": "halation diffusion filter",
  "Creative Tilt Lens": "creative tilt lens effect",
  "Extreme Macro": "extreme macro lens",
};
export const FOCAL = { 8: "ultra-wide perspective", 14: "wide-angle perspective", 24: "wide-angle dynamic perspective", 35: "natural cinematic perspective", 50: "standard portrait perspective", 85: "classic portrait perspective" };
export const APERTURE = { "f/1.4": "shallow depth of field, creamy bokeh", "f/4": "balanced depth of field", "f/11": "deep focus clarity, sharp foreground to background" };
export const CAMERA_ASSETS = {
  "Modular 8K Digital": "/assets/cinema/modular_8k_digital.webp",
  "Full-Frame Cine Digital": "/assets/cinema/full_frame_cine_digital.webp",
  "Grand Format 70mm Film": "/assets/cinema/grand_format_70mm_film.webp",
  "Studio Digital S35": "/assets/cinema/studio_digital_s35.webp",
  "Classic 16mm Film": "/assets/cinema/classic_16mm_film.webp",
  "Premium Large Format Digital": "/assets/cinema/premium_large_format_digital.webp",
  "Creative Tilt Lens": "/assets/cinema/creative_tilt_lens.webp",
  "Compact Anamorphic": "/assets/cinema/compact_anamorphic.webp",
  "Extreme Macro": "/assets/cinema/extreme_macro.webp",
  "70s Cinema Prime": "/assets/cinema/70s_cinema_prime.webp",
  "Classic Anamorphic": "/assets/cinema/classic_anamorphic.webp",
  "Premium Modern Prime": "/assets/cinema/premium_modern_prime.webp",
  "Warm Cinema Prime": "/assets/cinema/warm_cinema_prime.webp",
  "Swirl Bokeh Portrait": "/assets/cinema/swirl_bokeh_portrait.webp",
  "Vintage Prime": "/assets/cinema/vintage_prime.webp",
  "Halation Diffusion": "/assets/cinema/halation_diffusion.webp",
  "Clinical Sharp Prime": "/assets/cinema/clinical_sharp_prime.webp",
};

// Camera moves for video, written the way video models understand them.
export const CAMERA_MOVES = [
  { id: "static", label: "Static", text: "static locked-off camera, no camera movement" },
  { id: "dolly-in", label: "Dolly in", text: "slow dolly-in toward the subject" },
  { id: "dolly-out", label: "Dolly out", text: "slow dolly-out away from the subject, revealing the surroundings" },
  { id: "push-in", label: "Push in (fast)", text: "fast push-in on the subject" },
  { id: "pan-left", label: "Pan left", text: "smooth pan to the left" },
  { id: "pan-right", label: "Pan right", text: "smooth pan to the right" },
  { id: "tilt-up", label: "Tilt up", text: "slow tilt up" },
  { id: "tilt-down", label: "Tilt down", text: "slow tilt down" },
  { id: "truck-left", label: "Truck left", text: "camera trucks left alongside the subject" },
  { id: "truck-right", label: "Truck right", text: "camera trucks right alongside the subject" },
  { id: "orbit", label: "Orbit", text: "camera orbits around the subject in a smooth arc" },
  { id: "crane-up", label: "Crane up", text: "crane shot rising up and over the scene" },
  { id: "crane-down", label: "Crane down", text: "crane shot descending toward the subject" },
  { id: "tracking", label: "Tracking", text: "tracking shot following the subject" },
  { id: "handheld", label: "Handheld", text: "handheld camera with subtle natural shake" },
  { id: "drone", label: "Drone / FPV", text: "aerial drone shot flying over the scene" },
  { id: "zoom-in", label: "Zoom in", text: "slow optical zoom in" },
  { id: "dolly-zoom", label: "Dolly zoom", text: "dolly zoom (vertigo effect) on the subject" },
];

// The final prompt: what the user wrote, plus camera look and movement.
// A prompt written as JSON (structured prompts for image models): an object
// or a list. Returns { json: false } for plain text, { json: true, ok, value }
// when it parses, { json: true, ok: false, error } when it looks like JSON but doesn't.
export function parseJsonPrompt(text) {
  const t = String(text || "").trim();
  if (!/^[[{]/.test(t)) return { json: false };
  try {
    const value = JSON.parse(t);
    return value && typeof value === "object" ? { json: true, ok: true, value } : { json: false };
  } catch (e) {
    return { json: true, ok: false, error: String(e?.message || e).replace(/^JSON\.parse: /, "") };
  }
}

// The prompt as sent: the user's text plus Camera and the camera move.
// Plain text gets them appended; a JSON object gets them as its own keys
// ("camera", "camera_movement"), so it stays valid JSON. A JSON object
// without additions is sent exactly as written.
export function composePrompt(prompt, { kind, camera, move }) {
  const raw = String(prompt || "");
  const text = raw.trim();
  const parsed = parseJsonPrompt(text);
  const extra = {};
  if (camera?.on) {
    const persp = FOCAL[camera.focal] || "";
    extra.camera = [
      `shot on a ${CAMERA[camera.camera] || camera.camera}`,
      `using a ${LENS[camera.lens] || camera.lens} at ${camera.focal}mm${persp ? ` (${persp})` : ""}`,
      `aperture ${camera.aperture}`,
      APERTURE[camera.aperture] || "",
      "cinematic lighting, natural color science, high dynamic range",
    ].filter((p) => p && p.trim()).join(", ");
  }
  if (kind === "video" && move) {
    const m = CAMERA_MOVES.find((x) => x.id === move);
    if (m) extra.camera_movement = m.text;
  }
  // Valid JSON is never broken: sent exactly as written unless keys are added.
  if (!Object.keys(extra).length) return parsed.ok ? raw : text;
  if (parsed.ok) {
    if (Array.isArray(parsed.value)) return raw; // a list has no place for extra keys
    const keep = {};
    for (const [k, v] of Object.entries(extra)) if (!(k in parsed.value)) keep[k] = v; // the user's own key wins
    return Object.keys(keep).length ? JSON.stringify({ ...parsed.value, ...keep }, null, 2) : raw;
  }
  return [text, ...Object.values(extra)].filter((p) => p && p.trim()).join(", ");
}

export const DEFAULT_CAMERA = { on: false, camera: "Full-Frame Cine Digital", lens: "Premium Modern Prime", focal: 35, aperture: "f/4" };
