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
  // MiniMax H3 in ComfyUI (this server): references are <Picture 1>…<Picture 9>.
  if (hint === "PictureN") return { image: (n) => `<Picture ${n}>`, video: (n) => `video ${n}`, audio: (n) => `audio ${n}` };
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
    // Never borrow this server's ComfyUI syntax for a cloud model (or the other way round).
    for (const m of list || []) if (m?.dzFamily === model.dzFamily && m !== model && (m.dzProvider === "local") === (model.dzProvider === "local")) { const s = refSyntaxOf(m); if (s) return s; }
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

// The files an element adds when the model has no native elements — fitted
// into the room the model has left after the user's own files: every element
// gets its main picture first, then more (up to 3 each) while there is room.
// Elements that don't fit at all are reported, not sent.
export function elementMedia(entry, elements = [], attached = {}) {
  const slot = (r) => entry?.slots.find((s) => s.role === r);
  const out = {};
  const dropped = [];
  let cut = 0;
  const ref = slot("reference");
  if (ref) {
    let room = Math.max(0, ref.max - (attached.reference || []).length);
    const withPics = elements.filter((e) => (e.images || []).length);
    const take = new Map(withPics.map((e) => [e.id, 0]));
    for (const e of withPics) { if (room > 0) { take.set(e.id, 1); room -= 1; } else dropped.push(e.name); }
    for (let round = 1; round < 3 && room > 0; round += 1) {
      for (const e of withPics) {
        if (room > 0 && take.get(e.id) === round && (e.images || []).length > round) { take.set(e.id, round + 1); room -= 1; }
      }
    }
    for (const e of withPics) cut += Math.max(0, Math.min(3, e.images.length) - take.get(e.id));
    out.reference = withPics.flatMap((e) => e.images.slice(0, take.get(e.id)).map((url) => ({ url, name: e.name, element: e.id })));
    if (!out.reference.length) delete out.reference;
  }
  const vid = slot("video");
  if (vid) {
    const room = Math.max(0, vid.max - (attached.video || []).length);
    const videos = elements.filter((e) => e.video).map((e) => ({ url: e.video, name: e.name, element: e.id }));
    if (videos.length) out.video = videos.slice(0, room);
    if (!out.video?.length) delete out.video;
  }
  // Every element that got nothing in (no room, or nothing this model takes).
  const got = new Set(Object.values(out).flat().map((f) => f.element));
  for (const e of elements) if (!got.has(e.id)) dropped.push(e.name);
  return { files: out, dropped: [...new Set(dropped)], cut };
}

// Attached files + elements → what the endpoint choice and the body use.
// `trimmed`: { dropped: [names], cut: pictures left out } when the model has too few slots.
export function mergeElements(entry, attached, elements = []) {
  if (!elements.length) return { attached, native: false, trimmed: null };
  if (entryTakesElements(entry)) return { attached, native: true, trimmed: null };
  const { files, dropped, cut } = elementMedia(entry, elements, attached);
  const merged = { ...attached };
  for (const [role, list] of Object.entries(files)) merged[role] = [...(attached[role] || []), ...list];
  return { attached: merged, native: false, trimmed: dropped.length || cut ? { dropped, cut } : null };
}

// ── Our prompt tags ─────────────────────────────────────────────────────────
// The prompt uses our own tags, whatever the model: @image1, @video1, @audio1 for
// attached files and @char_mike / @prop_glass / @loc_bar / @obj_x for elements.
// At send time each becomes what this model understands (@Image3, @image_3,
// @element_1, …) — or plain words when the model has no @-syntax.
const CYR = { а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", є: "ye", ё: "e", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const TAG_PREFIX = { character: "char", object: "prop", place: "loc", other: "obj" };
export function elementTag(e) {
  if (e?.tag) return String(e.tag).replace(/^@/, "");
  const latin = String(e?.name || "").toLowerCase().split("").map((c) => CYR[c] ?? c).join("");
  const slug = latin.normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "x";
  return `${TAG_PREFIX[e?.kind] || "obj"}_${slug}`;
}
// Unique tags for a list of elements (a second "Mike" becomes char_mike_2).
export function elementTags(elements = []) {
  const seen = new Map();
  const out = new Map();
  for (const e of elements) {
    const base = elementTag(e);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    out.set(e.id, n > 1 ? `${base}_${n}` : base);
  }
  return out;
}

// Can this element go into this model at all (pictures as references, or its video)?
export function elementFits(entry, e) {
  if (!entry || !e) return false;
  if (entryTakesElements(entry)) return Boolean((e.images || []).length || e.video);
  const has = (r) => entry.slots.some((s) => s.role === r);
  return Boolean((has("reference") && (e.images || []).length) || (has("video") && e.video));
}

// Every tag the prompt can use now, with what it turns into for this model.
//   [{ tag, to, label, kind: 'file'|'element', role?, url?, element?, unused? }]
// References are numbered on their own (@image1 = the first reference image the
// model gets), frames have their own tags (@first, @middle, @last). A model
// with no reference input numbers its frames as images instead.
const FRAME_WORDS = { first: "the start frame", middle: "the middle frame", last: "the end frame" };
export function promptTags({ attached = {}, syntax = null, elements = [], elementPairs = [], variant = null }) {
  const out = [];
  const tagOf = elementTags(elements);
  const hasRefInput = variant ? Boolean(variant.media?.reference) : Boolean((attached.reference || []).length);
  let frameN = 0;
  for (const role of ["first", "middle", "last"]) {
    for (const f of attached[role] || []) {
      frameN += 1;
      const to = !hasRefInput && syntax ? syntax.image(frameN) : FRAME_WORDS[role];
      out.push({ tag: role, to, label: ROLE_INFO[role]?.label || role, kind: "file", role, url: f.url });
    }
  }
  let n = 0;
  const firstImage = new Map(); // element id → its first reference number
  for (const f of attached.reference || []) {
    n += 1;
    if (f.element) { if (!firstImage.has(f.element)) firstImage.set(f.element, n); continue; }
    out.push({ tag: `image${n}`, to: syntax ? syntax.image(n) : `image ${n}`, label: ROLE_INFO.reference?.label || "Reference", kind: "file", role: "reference", url: f.url });
  }
  let v = 0;
  const firstVideo = new Map();
  for (const role of ["video", "source"]) {
    for (const f of attached[role] || []) {
      v += 1;
      if (f.element) { if (!firstVideo.has(f.element)) firstVideo.set(f.element, v); continue; }
      out.push({ tag: `video${v}`, to: syntax ? syntax.video(v) : `video ${v}`, label: ROLE_INFO[role]?.label || "Video", kind: "file", role, url: f.url });
    }
  }
  let a = 0;
  for (const f of attached.audio || []) { a += 1; out.push({ tag: `audio${a}`, to: syntax ? syntax.audio(a) : `audio ${a}`, label: "Audio", kind: "file", role: "audio", url: f.url }); }
  const native = new Map(elementPairs.map((p, i) => [p.element.id, `@element_${i + 1}`]));
  for (const e of elements) {
    const tag = tagOf.get(e.id);
    let to = null;
    if (native.size) to = native.get(e.id) || null;
    else if (firstImage.has(e.id)) to = syntax ? syntax.image(firstImage.get(e.id)) : `${e.name} (image ${firstImage.get(e.id)})`;
    else if (firstVideo.has(e.id)) to = syntax ? syntax.video(firstVideo.get(e.id)) : `${e.name} (video ${firstVideo.get(e.id)})`;
    out.push({ tag, to: to || e.name, label: e.name, kind: "element", element: e, url: e.images?.[0] || null, unused: !to });
  }
  return out;
}

// The prompt with our tags turned into the model's own words. Anything else
// that starts with @ (a model tag typed by hand, an e-mail) stays as it is.
// Inside a JSON prompt the replacement is escaped for a JSON string, so a name
// with quotes can't break it. A tag is a whole word: "abc@image1" is left alone.
export const TAG_RE = /(^|[^\p{L}\p{N}_@])@([a-z][a-z0-9_]*)(?![\p{L}\p{N}_])/giu;
export function translateTags(prompt, tags = []) {
  if (!tags.length) return prompt;
  const map = new Map(tags.map((t) => [t.tag.toLowerCase(), t.to]));
  // Other spellings people type: @img1, @image_1, @video_1.
  for (const t of tags) {
    const m = /^(image|video|audio)(\d+)$/.exec(t.tag);
    if (!m) continue;
    map.set(`${m[1]}_${m[2]}`, t.to);
    if (m[1] === "image") map.set(`img${m[2]}`, t.to);
  }
  const text = String(prompt || "");
  const json = parseJsonPrompt(text).ok;
  return text.replace(TAG_RE, (all, pre, name) => {
    const to = map.get(name.toLowerCase());
    if (to == null) return all;
    return `${pre}${json ? JSON.stringify(String(to)).slice(1, -1) : to}`;
  });
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
