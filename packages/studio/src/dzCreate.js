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

const LISTS = { image: ["t2i", "i2i"], video: ["t2v", "i2v", "v2v"], audio: ["t2a"] };
const MODE_ORDER = { t2i: 0, i2i: 1, t2v: 0, i2v: 1, v2v: 2, t2a: 0 };

// ── Media roles ─────────────────────────────────────────────────────────────

export const ROLE_INFO = {
  first: { label: "Start frame", kind: "image" },
  middle: { label: "Middle frames", kind: "image" },
  last: { label: "End frame", kind: "image" },
  reference: { label: "References", kind: "image" },
  video: { label: "Reference videos", kind: "video" },
  source: { label: "Video to edit", kind: "video" },
  audio: { label: "Audio", kind: "audio" },
  // Package 03: a picture to change, for image models that can edit. Providers have
  // no field of its own for it — it is sent as the first input image (see withEditFirst).
  edit: { label: "Image to edit", kind: "image" },
};
export const ROLE_ORDER = ["first", "middle", "last", "reference", "video", "source", "audio"];

// "Image to edit" goes first into the model's images when the model can edit;
// otherwise it stays its own role and is reported as not used.
export function withEditFirst(attached = {}, entry = null) {
  const edit = attached.edit || [];
  if (!edit.length || !entry?.canEdit) return attached;
  const { edit: _e, ...rest } = attached;
  return { ...rest, reference: [{ ...edit[0], edit: true }, ...(attached.reference || [])] };
}
// …and back, for what the strip shows.
export function splitEdit(attached = {}) {
  const refs = attached.reference || [];
  if (!refs.some((f) => f.edit)) return attached;
  return { ...attached, edit: refs.filter((f) => f.edit), reference: refs.filter((f) => !f.edit) };
}

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
  // One field of a typed reference list (Wan 3.0 "refers__video"): a reference video.
  if (input.field === "video") return VIDEO_REF.test(name) || /__video$/.test(name) ? "video" : "source";
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

// Every variant (endpoint) of one model at one provider, for Image, Video or
// Audio. `match`: only endpoints it accepts (Tools: lip sync, motion control…).
export function createEntries(kind, { match = null } = {}) {
  const lists = (typeof window !== "undefined" && window.__DZ_CATALOG__?.lists) || {};
  const byKey = new Map();
  for (const mode of LISTS[kind]) {
    for (const model of lists[mode] || []) {
      if (!model?.endpoint || !model.dzFamily) continue;
      if (match && !match.test(model.endpoint)) continue;
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
    // An image model with an image-to-image endpoint can change a picture.
    entry.canEdit = kind === "image" && entry.variants.some((v) => v.mode === "i2i" && v.media.reference);
    if (entry.canEdit) entry.slots = [{ role: "edit", max: 1 }, ...entry.slots];
    entry.textOnly = entry.variants.some((v) => Object.keys(v.media).length === 0 && v.model.hasPrompt !== false);
  }
  // Which other providers of the same family take a slot this one doesn't
  // (APIMart vs Atlas): the reason for an off file names them.
  const all = [...byKey.values()];
  for (const entry of all) {
    entry.alsoAt = {};
    for (const other of all) {
      if (other === entry || other.family !== entry.family) continue;
      for (const s of other.slots) {
        if (entry.slots.some((x) => x.role === s.role)) continue;
        (entry.alsoAt[s.role] ||= []).push(other.providerName || other.provider);
      }
    }
  }
  return all.sort((a, b) => (a.recommended ?? 1e9) - (b.recommended ?? 1e9) || a.familyName.localeCompare(b.familyName));
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
// The prompt uses our own tags, whatever the model: @start, @mid1, @end for
// frames, @img1, @vid1, @aud1 for attached files (Denis 19.11: short names) and
// @char_mike / @prop_glass / @loc_bar / @obj_x for elements.
// At send time each becomes what this model understands (@Image3, @image_3,
// @element_1, …) — or plain words when the model has no @-syntax.
const CYR = { а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", є: "ye", ё: "e", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const TAG_PREFIX = { character: "char", object: "prop", place: "loc", other: "obj" };
// Names the attachments use (and used before 19.11): an element never gets one.
const RESERVED_TAG = /^(start|end|edit|first|last|middle|mid_?\d+|img_?\d+|vid_?\d+|aud_?\d+|image_?\d+|video_?\d+|audio_?\d+)$/i;
export function elementTag(e) {
  const own = e?.tag ? String(e.tag).replace(/^@/, "") : null;
  if (own) return RESERVED_TAG.test(own) ? `el_${own}` : own;
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
// References are numbered on their own (@img1 = the first reference image the
// model gets), frames have their own tags (@start, @mid1…, @end). A model
// with no reference input numbers its frames as images instead.
const FRAME_WORDS = { first: "the start frame", middle: "the middle frame", last: "the end frame" };
export function promptTags({ attached = {}, all = null, syntax = null, elements = [], elementPairs = [], variant = null }) {
  const out = [];
  const tagOf = elementTags(elements);
  const hasRefInput = variant ? Boolean(variant.media?.reference) : Boolean((attached.reference || []).length);
  // Two passes: what is sent decides each file's number at the model (`to`); the
  // whole attachment list decides its tag, so a tag does not change when a
  // model can't take some files (redesign 02, §2.1). Files the model does not
  // get keep their tag, marked `unused`, and are left out of the sent prompt.
  // `own` counts the user's files in a role: what is sent is always the first N of
  // them, so role + own index names the same file in both passes (even a repeated url).
  const walk = (att, cb) => {
    const own = {};
    const go = (f, role, k) => { const i = own[role] || 0; if (!f.element) own[role] = i + 1; cb(f, role, { ...k, own: i }); };
    let frameN = 0;
    for (const role of ["first", "middle", "last"]) {
      (att[role] || []).forEach((f, i) => { frameN += 1; go(f, role, { frameN, i, mids: (att.middle || []).length }); });
    }
    let n = 0;
    let r = 0; // the user's reference number: the picture to edit is not one of them
    for (const f of att.reference || []) { n += 1; if (!f.edit) r += 1; go(f, "reference", { n, r }); }
    let v = 0;
    for (const role of ["video", "source"]) for (const f of att[role] || []) { v += 1; go(f, role, { v }); }
    let a = 0;
    for (const f of att.audio || []) { a += 1; go(f, "audio", { a }); }
    // A picture to edit the model can't take stays its own role: its tag is marked unused.
    for (const f of att.edit || []) go(f, "edit", { edit: true });
  };
  const sentTo = new Map();
  const firstImage = new Map(); // element id → its first reference number at the model
  const firstVideo = new Map();
  walk(attached, (f, role, k) => {
    if (f.element) {
      if (role === "reference" && !firstImage.has(f.element)) firstImage.set(f.element, k.n);
      if ((role === "video" || role === "source") && !firstVideo.has(f.element)) firstVideo.set(f.element, k.v);
      return;
    }
    if (k.edit) return;
    let to;
    if (k.frameN) to = !hasRefInput && syntax ? syntax.image(k.frameN) : role === "middle" && k.mids > 1 ? `${FRAME_WORDS.middle} ${k.i + 1}` : FRAME_WORDS[role];
    else if (role === "reference") to = syntax ? syntax.image(k.n) : `image ${k.n}`;
    else if (k.v) to = syntax ? syntax.video(k.v) : `video ${k.v}`;
    else to = syntax ? syntax.audio(k.a) : `audio ${k.a}`;
    sentTo.set(`${role}|${k.own}`, to);
  });
  walk(all || attached, (f, role, k) => {
    if (f.element) return;
    let tag;
    let label;
    if (k.frameN) {
      tag = role === "first" ? "start" : role === "last" ? "end" : `mid${k.i + 1}`;
      label = role === "first" ? "Start frame" : role === "last" ? "End frame" : `Mid ${k.i + 1}`;
    } else if (k.edit || (role === "reference" && f.edit)) { tag = "edit"; label = "Image to edit"; }
    else if (role === "reference") { tag = `img${k.r}`; label = `Reference ${k.r}`; }
    else if (k.v) { tag = `vid${k.v}`; label = role === "source" ? "Video to edit" : `Reference video ${k.v}`; }
    else { tag = `aud${k.a}`; label = `Audio ${k.a}`; }
    const key = `${role}|${k.own}`;
    const unused = !sentTo.has(key);
    out.push({ tag, to: unused ? "" : sentTo.get(key), label, kind: "file", role, url: f.url, ...(unused ? { unused: true } : {}) });
  });
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
const LONG = { img: "image", vid: "video", aud: "audio" };
function OLD_SPELLINGS(tag) {
  if (tag === "start") return ["first"];
  if (tag === "end") return ["last"];
  if (tag === "mid1") return ["middle", "mid_1"];
  const m = /^(img|vid|aud|mid)(\d+)$/.exec(tag);
  if (!m) return [];
  if (m[1] === "mid") return [`mid_${m[2]}`];
  return [`${m[1]}_${m[2]}`, `${LONG[m[1]]}${m[2]}`, `${LONG[m[1]]}_${m[2]}`];
}
// Prompts written before 19.11 use the long names the app gave attachments
// (@image1, @first…): rewrite them once (saved state, reused results). Names in
// `keep` (the prompt's own element tags) and spellings the app never made
// (@image_1, typed for a model) are left as they are.
const OLD_TAG = { first: "start", last: "end", middle: "mid1" };
export function migrateTags(prompt, keep = null) {
  const text = String(prompt ?? "");
  if (!text.includes("@")) return text;
  const kept = new Set([...(keep || [])].map((x) => String(x).toLowerCase()));
  return text.replace(TAG_RE, (all, pre, name) => {
    const low = name.toLowerCase();
    if (kept.has(low)) return all;
    if (OLD_TAG[low]) return `${pre}@${OLD_TAG[low]}`;
    const m = /^(image|video|audio)(\d+)$/.exec(low);
    if (m) return `${pre}@${{ image: "img", video: "vid", audio: "aud" }[m[1]]}${m[2]}`;
    return all;
  });
}
// Mentions of files this model does not get (a start frame turns references off on most
// video models), made readable instead of cut out (acceptance of handoff 17, defect 1):
//   "@img1 is the woman, …"            → the definition clause goes (it names nothing now)
//   "The woman from @img1 sits"        → "The woman sits" (the noun before already says it)
//   "@img1 sits at the counter"        → "The woman sits at the counter" (its definition)
//   "(@img1)"                          → gone
// What is left without a definition is reported in `lost`: the studio warns before sending,
// and those mentions are still cut out of the sent text.
// `alias`: lower-case spelling → its tag, for the files not sent.
const ARTICLE = "(?:the|a|an|her|his|their|its|our|my|this|that)";
const CONNECTOR = "(?:from|as shown in|shown in|as seen in|seen in|as in|like in|depicted in|pictured in)";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function unsentWords(text, alias) {
  if (!alias.size) return { text, lost: [] };
  const names = [...alias.keys()].sort((a, b) => b.length - a.length).map(esc).join("|");
  const at = `@(${names})(?![\\p{L}\\p{N}_])`;
  const pre = "(^|[^\\p{L}\\p{N}_@])";
  const defs = new Map();
  let out = text;
  // 1. Definitions: "@img1 is the woman" / "@img1: the woman" (an article first, at most ten words), or
  //    "@img1 — жінка" / "@img1 = the woman" (any words: other languages have no article). The
  //    separator after it goes too; a lookbehind (not a consumed character) marks the start, so a
  //    definition right after "the woman,@img2 …" is still found.
  const DEF = `(?<![\\p{L}\\p{N}_@])${at}\\s*(?:(?:\\bis\\b|:|\\bshows\\b)\\s*(${ARTICLE}\\s+[^,.;:!?\\n@]{1,80}?)|(?:=|—|–)\\s*([^,.;:!?\\n@]{1,80}?))(?=\\s*(?:[,.;!?\\n]|$|\\band\\b\\s*@))(\\s*(?:,|;|\\band\\b))?`;
  out = out.replace(new RegExp(DEF, "giu"), (all, name, en, other) => {
    const phrase = (en || other || "").trim();
    const words = phrase.split(/\s+/);
    if (!phrase || words.length > 10) return all;
    const tag = alias.get(name.toLowerCase());
    if (!defs.has(tag)) defs.set(tag, /^(a|an)$/i.test(words[0]) ? `the ${words.slice(1).join(" ")}` : en ? words.join(" ").replace(/^\w/, (c) => c.toLowerCase()) : phrase);
    return "";
  });
  // 2. "the woman from @img1", "the bowl (@img3)": the words before already name it.
  out = out.replace(new RegExp(`\\s+${CONNECTOR}\\s+${at}`, "giu"), "");
  out = out.replace(new RegExp(`\\s*\\(\\s*${at}\\s*\\)`, "giu"), "");
  // 3. The rest: its definition, with a capital where it opens a sentence; no definition → lost.
  const lost = new Set();
  out = out.replace(new RegExp(`${pre}${at}`, "giu"), (all, p, name, offset, whole) => {
    const tag = alias.get(name.toLowerCase());
    const def = defs.get(tag);
    if (!def) { lost.add(tag); return all; }
    const before = whole.slice(0, offset + p.length);
    const opens = /(^|[.!?]\s+|\n\s*)["“«'(\[]*$/.test(before);
    return `${p}${opens ? def[0].toUpperCase() + def.slice(1) : def}`;
  });
  // Tidy what the removed clauses leave: a sentence start "., " or ", ", an empty sentence, double
  // spaces. Only when something was rewritten, and never across line breaks or indentation.
  if (out === text) return { text, lost: [...lost] };
  out = out
    .replace(/(^|[.!?][ \t]+|\n)[ \t]*(?:[,;][ \t]*)+/g, "$1")
    .replace(/(^|\n)[ \t]*[.;,](?=[ \t]|$)[ \t]*/g, "$1")
    .replace(/([.!?])([ \t]+[.!?])+(?=\s|$)/g, "$1")
    // a label left with nothing after it ("Characters: ." once its definition went)
    .replace(/(^|\n|[.!?][ \t]+)[^\n.!?:]{1,40}:[ \t]*[.;,][ \t]*/gu, "$1")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/(\S)[ \t]+([,.;:!?])/g, "$1$2")
    .replace(/[,;][ \t]*([.!?])/g, "$1");
  if (!/^\s/.test(text)) out = out.replace(/^[ \t]+/, "");
  return { text: out, lost: [...lost] };
}
function unsentAlias(tags) {
  const alias = new Map();
  for (const t of tags) {
    if (t.kind !== "file" || t.to !== "") continue;
    for (const n of [t.tag, ...OLD_SPELLINGS(t.tag)]) if (!alias.has(n.toLowerCase())) alias.set(n.toLowerCase(), t.tag);
  }
  return alias;
}
// The tags the prompt names whose files this model does not get and that the prompt never
// defines ("@img2 is the ramen shop"): the studio says so before sending.
export function unsentMentions(prompt, tags = []) {
  const text = String(prompt || "");
  if (!tags.length || parseJsonPrompt(text).ok) return [];
  return unsentWords(text, unsentAlias(tags)).lost;
}

export function translateTags(prompt, tags = []) {
  if (!tags.length) return prompt;
  const map = new Map(tags.map((t) => [t.tag.toLowerCase(), t.to]));
  // Other spellings people type, and the names used before 19.11 (@image1, @first…).
  for (const t of tags) {
    for (const old of OLD_SPELLINGS(t.tag)) if (!map.has(old)) map.set(old, t.to);
  }
  const raw = String(prompt || "");
  const json = parseJsonPrompt(raw).ok;
  const text = json ? raw : unsentWords(raw, unsentAlias(tags)).text;
  return text.replace(TAG_RE, (all, pre, name, at) => {
    const to = map.get(name.toLowerCase());
    if (to == null) return all;
    if (to === "") return `${pre}\u0000`; // a file this model does not get
    // A tag that opens a sentence opens it with a capital ("Image 2 is…", package 13 C4).
    // Not right after a list number ("2. image 3: …").
    const before = text.slice(0, at + pre.length);
    const opens = !json && /^[a-z]/.test(to) && /(^|[.!?]\s+|\n\s*)$/.test(before) && !/(^|\n)\s*\d+[.)]\s*$/.test(before);
    const word = opens ? to[0].toUpperCase() + to.slice(1) : to;
    return `${pre}${json ? JSON.stringify(String(to)).slice(1, -1) : word}`;
  }).replace(/ ?\u0000 ?/g, (m) => (m.length === 3 ? " " : ""));
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
  // An endpoint made for a video to edit is never picked without one (APIMart's
  // video endpoint is fixed to "edit": with pictures only it is refused, 400).
  const score = (v) => (missingFor(v, attached) ? 1000 : 0) + (v.media.source && !used.includes("source") ? 500 : 0) + Object.keys(v.media).length;
  return [...fits].sort((a, b) => score(a) - score(b))[0];
}

// ── What is sent, and what is not (package 04) ──────────────────────────────
// A model at a provider has several endpoints (image-to-video, reference-to-video,
// video edit…), each taking its own media with its own limits. Two slots conflict
// when no endpoint takes both: that comes from the catalog (every endpoint's own
// inputs), never from a list per model. Every attached file is either on (sent) or
// off (kept, dimmed, never sent). The plan picks the endpoint; when slots conflict,
// the one the user touched last wins (`touched`: roles, most recent first).
const NOUN = {
  first: ["start frame", "start frames"], middle: ["middle frame", "middle frames"], last: ["end frame", "end frames"],
  reference: ["reference image", "reference images"], video: ["reference video", "reference videos"],
  source: ["video to edit", "videos to edit"], audio: ["audio file", "audio files"],
  edit: ["picture to edit", "pictures to edit"],
};
// Group words, as the strip names the groups.
const GROUP_WORD = { first: "frames", middle: "frames", last: "frames", reference: "references", video: "reference videos", source: "a video to edit", audio: "audio", edit: "a picture to edit" };
const ONE = { first: "a start frame", middle: "middle frames", last: "an end frame", reference: "references", video: "reference videos", source: "a video to edit", audio: "audio", edit: "a picture to edit" };
const SHORT = { first: "Start", middle: "Mid", last: "End" };
const FRAME_ROLES = new Set(["first", "middle", "last"]);
const nounOf = (role, n) => NOUN[role][n === 1 ? 0 : 1];
const listWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const orWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const uniq = (xs) => [...new Set(xs)];

// Lexicographic: the first role in `order` that one endpoint takes and the other does not decides.
function takesFirst(order, a, b) {
  for (const r of order) {
    const x = a.v.media[r] ? 1 : 0;
    const y = b.v.media[r] ? 1 : 0;
    if (x !== y) return y - x;
  }
  return 0;
}

function pickEndpoint(entry, attached, roles, touched) {
  const evals = entry.variants.map((v) => {
    const sent = {};
    let count = 0;
    for (const role of roles) {
      const m = v.media[role];
      if (!m) continue;
      sent[role] = attached[role].slice(0, m.max);
      count += sent[role].length;
    }
    return { v, sent, count };
  });
  // 1. Roles the user touched, the last touched first. 2. An endpoint that can run with
  // what it gets. 3. The other roles in the strip's order. 4. The most files, then the simplest.
  const first = touched.filter((r) => roles.includes(r));
  const rest = roles.filter((r) => !first.includes(r));
  const ready = (e) => (e.count > 0 && !missingFor(e.v, e.sent) ? 0 : 1);
  evals.sort((a, b) => takesFirst(first, a, b) || ready(a) - ready(b) || takesFirst(rest, a, b) || b.count - a.count || Object.keys(a.v.media).length - Object.keys(b.v.media).length);
  return evals[0] || null;
}

// "Image to edit" travels inside the references (withEditFirst): touching it touches them.
const touchedRoles = (touched, attached) => uniq((touched || []).map((r) => (r === "edit" && !(attached.edit || []).length ? "reference" : r)));

export function planAttachments(entry, attached = {}, { touched = [], explain = true } = {}) {
  const roles = [...ROLE_ORDER, "edit"].filter((r) => (attached[r] || []).length);
  const empty = { variant: null, sent: {}, unused: [], off: [], onRoles: [] };
  if (!entry) return empty;
  const order = touchedRoles(touched, attached);
  const best = pickEndpoint(entry, attached, roles, order);
  if (!best) return empty;
  const takes = (role) => entry.variants.some((v) => v.media[role]);
  const onRoles = Object.keys(best.sent).filter((r) => best.sent[r].length);
  const off = [];
  const roleOf = (f, role) => (f.edit ? "edit" : role);
  for (const role of roles) {
    const list = attached[role];
    const m = best.v.media[role];
    if (m) {
      list.slice(m.max).forEach((f, i) => off.push({ ...f, role: roleOf(f, role), index: m.max + i, why: "limit", max: m.max, canTurnOn: true }));
      continue;
    }
    const why = takes(role) ? "together" : "kind";
    list.forEach((f, index) => off.push({ ...f, role: roleOf(f, role), index, why, canTurnOn: why === "together" }));
  }
  // What a click on an off slot turns off: the plan as if it were touched last.
  if (explain) {
    const turnsOff = {};
    for (const role of uniq(off.filter((x) => x.why === "together").map((x) => (x.role === "edit" ? "reference" : x.role)))) {
      const next = planAttachments(entry, attached, { touched: [role, ...order], explain: false });
      turnsOff[role] = onRoles.filter((r) => !next.onRoles.includes(r));
    }
    for (const x of off) x.reason = offReason(entry, x, { onRoles, turnsOff: turnsOff[x.role === "edit" ? "reference" : x.role] || [], variant: best.v });
  }
  return { variant: best.v, sent: best.sent, unused: off, off, onRoles };
}

// The tooltip of an off file (package 04, §2.4): the reason, and what a click does.
export function offReason(entry, x, { onRoles = [], turnsOff = [], variant = null } = {}) {
  const name = entry?.familyName || "This model";
  const role = x.role;
  if (x.why === "limit") {
    return { text: `${name} takes ${x.max} ${nounOf(role, x.max)}.`, action: "Click to choose which ones are sent" };
  }
  if (x.why === "kind") {
    const takes = (r) => entry?.variants.some((v) => v.media[r]);
    const text = {
      middle: takes("first") && takes("last") ? `${name} takes Start and End frames only, no middle frames.`
        : takes("first") ? `${name} takes a start frame only, no middle frames.`
          : takes("last") ? `${name} takes an end frame only, no middle frames.` : `${name} takes no frames.`,
      first: `${name} takes no start frame.`,
      last: `${name} takes no end frame.`,
      reference: `${name} takes no reference images.`,
      video: `${name} takes no reference videos.`,
      source: `${name} can't edit a video.`,
      audio: `${name} takes no audio.`,
      edit: `${name} can't edit a picture.`,
    }[role] || `${name} doesn't take this file.`;
    // The same model at another provider takes it: say whose limit this is.
    const others = uniq(entry?.alsoAt?.[role] || []);
    if (others.length && entry?.providerName) {
      return {
        text: `${text.replace(name, `${name} at ${entry.providerName}`)} ${orWords(others)} ${others.length > 1 ? "take" : "takes"} ${ONE[role] || "it"}.`,
        action: `To use it, choose ${orWords(others)} in the model menu`,
      };
    }
    return { text, action: "" };
  }
  // Together: some of the same group stays on → "With references this model takes a start frame only."
  const sameGroup = FRAME_ROLES.has(role) ? onRoles.filter((r) => FRAME_ROLES.has(r)) : [];
  const blockers = uniq(turnsOff.map((r) => GROUP_WORD[r]));
  const blockWords = listWords(blockers) || "the other files";
  if (sameGroup.length) {
    const kept = listWords(sameGroup.map((r) => ONE[r]));
    return { text: `With ${blockWords} ${name} takes ${kept} only.`, action: `Click ${SHORT[role] || "it"} to use it instead of the ${blockWords}` };
  }
  // In the strip's order: "frames or references", whichever side is hovered.
  const SIDE_ORDER = ["a picture to edit", "frames", "references", "reference videos", "a video to edit", "audio"];
  const sides = uniq([GROUP_WORD[role], ...blockers]).sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
  return { text: `${name} takes ${orWords(sides)}, not ${sides.length > 2 ? "together" : "both"}.`, action: "Click to use these instead" };
}

// What is missing for the chosen endpoint (required media) — null when ready.
export function missingFor(variant, attached, labels = {}) {
  if (!variant) return null;
  for (const field of variant.model.required || []) {
    const input = variant.model.inputs?.[field];
    if (!input?.field) continue;
    const role = Object.entries(variant.media).find(([, m]) => m.field === field)?.[0];
    if (role && !(attached[role] || []).length) return `${labels[role] || ROLE_INFO[role].label} is required for this model.`;
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

// ── Camera look ────────────────────────────────────────────────────────────
// Camera, lens, focal length, aperture, filter, era, light and the camera move.
// The choices (ids) go to the server with the request (`_dz.look`); the server
// writes them into the prompt in the chosen model's words and place
// (gateway/src/look.js). Here: only the lists to draw the controls.
const LOOK_FALLBACK = { cameras: [], lenses: [], filters: [], focals: [], apertures: [], eras: [], lights: [], palettes: [], genres: [], moves: [], defaults: { camera: "modern", lens: "clean", focal: 35, aperture: "f/4" } };
export function lookData() {
  return (typeof window !== "undefined" && window.__DZ_CATALOG__?.look) || LOOK_FALLBACK;
}
export const DEFAULT_CAMERA = { on: false, camera: "modern", lens: "clean", focal: 35, aperture: "f/4", filter: null, era: null, light: null };
// Settings saved before 18.11 used display names; the server maps those too.
const LEGACY_CAMERA = { "Modular 8K Digital": "digital", "Full-Frame Cine Digital": "digital", "Studio Digital S35": "digital", "Grand Format 70mm Film": "imax-70", "Classic 16mm Film": "film-16", "Premium Large Format Digital": "large-format" };
const LEGACY_LENS = { "Premium Modern Prime": "clean", "Clinical Sharp Prime": "clean", "Classic Anamorphic": "anamorphic", "Compact Anamorphic": "anamorphic", "70s Cinema Prime": "vintage-prime", "Warm Cinema Prime": "vintage-prime", "Vintage Prime": "vintage-prime", "Swirl Bokeh Portrait": "petzval", "Halation Diffusion": "clean", "Creative Tilt Lens": "tilt-shift", "Extreme Macro": "macro" };
// Studio (redesign 01): every part of the look is its own choice, Auto (null) by default.
export const AUTO_LOOK = { auto: true, camera: null, lens: null, focal: null, aperture: null, filter: null, palette: null, light: null, genre: null, era: null };
const strOrNull = (x) => (typeof x === "string" && x ? x : null);
export function autoLook(c) {
  const v = c && typeof c === "object" ? c : {};
  if (v.auto) {
    const focal = Number(v.focal);
    return { ...AUTO_LOOK, camera: strOrNull(v.camera), lens: strOrNull(v.lens), focal: Number.isFinite(focal) && focal > 0 ? focal : null, aperture: strOrNull(v.aperture), filter: strOrNull(v.filter),
      palette: strOrNull(v.palette), light: strOrNull(v.light), genre: strOrNull(v.genre), era: strOrNull(v.era) };
  }
  const old = normalizeCamera(v);
  return { ...AUTO_LOOK, ...(old.on ? { camera: old.camera, lens: old.lens, focal: old.focal, aperture: old.aperture } : {}), filter: old.filter || null, era: old.era, light: old.light };
}
export function normalizeCamera(c, { auto = false } = {}) {
  const v = c && typeof c === "object" ? c : {};
  if (auto) return autoLook(v);
  if (v.auto) { const a = autoLook(v); return normalizeCamera({ on: Boolean(a.camera || a.lens || a.focal || a.aperture), camera: a.camera, lens: a.lens, focal: a.focal, aperture: a.aperture, filter: a.filter, era: a.era, light: a.light }); }
  const focal = { 8: 12, 14: 16 }[Number(v.focal)] || Number(v.focal) || DEFAULT_CAMERA.focal;
  return {
    ...DEFAULT_CAMERA,
    on: Boolean(v.on),
    camera: LEGACY_CAMERA[v.camera] || v.camera || DEFAULT_CAMERA.camera,
    lens: LEGACY_LENS[v.lens] || v.lens || DEFAULT_CAMERA.lens,
    focal,
    aperture: typeof v.aperture === "string" ? v.aperture : DEFAULT_CAMERA.aperture,
    filter: v.filter || (v.lens === "Halation Diffusion" ? "diffusion" : null),
    era: typeof v.era === "string" ? v.era : null,
    light: typeof v.light === "string" ? v.light : null,
  };
}
// What goes to the server: null when nothing is chosen.
export function lookOf(camera, move = "") {
  if (camera?.auto) {
    const a = autoLook(camera);
    const look = { on: Boolean(a.camera || a.lens || a.focal || a.aperture), camera: a.camera, lens: a.lens, focal: a.focal, aperture: a.aperture, filter: a.filter,
      era: a.era, light: a.light, palette: a.palette, genre: a.genre, move: move || null };
    return look.on || look.filter || look.era || look.light || look.palette || look.genre || look.move ? look : null;
  }
  const c = normalizeCamera(camera);
  const look = { ...(c.on ? { on: true, camera: c.camera, lens: c.lens, focal: c.focal, aperture: c.aperture } : { on: false }), filter: c.filter, era: c.era, light: c.light, move: move || null };
  return look.on || look.filter || look.era || look.light || look.move ? look : null;
}
// Short label for buttons ("35mm Film · 50mm · f/2").
export function lookLabel(camera) {
  const d = lookData();
  const name = (list, id) => (list || []).find((x) => x.id === id)?.label || "";
  if (camera?.auto) {
    const a = autoLook(camera);
    return [name(d.cameras, a.camera), name(d.lenses, a.lens), a.focal ? `${a.focal}mm` : "", a.aperture || "", name(d.palettes, a.palette), name(d.lights, a.light), name(d.genres, a.genre), name(d.eras, a.era)].filter(Boolean).join(" · ");
  }
  const c = normalizeCamera(camera);
  return [c.on ? name(d.cameras, c.camera) : "", c.on ? `${c.focal}mm` : "", c.on ? c.aperture : "", name(d.eras, c.era), name(d.lights, c.light)].filter(Boolean).join(" · ");
}

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
export function composePrompt(prompt) {
  // The camera look is added on the server; here only: valid JSON is sent exactly as written.
  const raw = String(prompt || "");
  return parseJsonPrompt(raw.trim()).ok ? raw : raw.trim();
}


// "Insert into prompt" from the chat (package 07, F1): the inserted text's tags
// become the composer's, bound to the right files.
//   refs     what each tag meant when the answer was written: [{ tag, url, src? }]
//            (src = the file the user picked; url = the chat's own copy)
//   tags     the composer's tags now (promptTags)
//   refCount the user's references attached now: a new one gets the next @img number
//   active   the chosen elements; candidates: every element the user can add here
//   canAdd   (element, howManyChosen) → null, or why it can't be added
// Returns { text, add: [url], addElements: [element], unmatched: [{ tag, why }] }.
// A picture already attached is matched by its file, not added twice. A mention
// with no file and no element behind it stays plain text.
const IMAGE_TAG = /^(img\d+|start|end|mid\d+|edit)$/;
function canonicalTag(name) {
  const low = String(name).toLowerCase();
  if (low === "first") return "start";
  if (low === "last") return "end";
  if (low === "middle") return "mid1";
  const m = /^(img|image|vid|video|aud|audio|mid)_?(\d+)$/.exec(low);
  if (m) return `${{ image: "img", video: "vid", audio: "aud" }[m[1]] || m[1]}${Number(m[2])}`;
  return low;
}
export function resolveInsertTags(text, { refs = [], tags = [], refCount = 0, active = [], candidates = [], canAdd = () => null } = {}) {
  const meant = new Map(); // tag → [urls], as the answer meant it
  for (const r of refs || []) {
    if (!r?.tag) continue;
    const key = canonicalTag(r.tag);
    const list = meant.get(key) || [];
    for (const u of [r.url, r.src]) if (typeof u === "string" && u && !list.includes(u)) list.push(u);
    meant.set(key, list);
  }
  // The tiles now, by file. One file can be two tiles (the start frame and a reference,
  // or the same picture twice): the tag the answer used wins when it still names that
  // file; otherwise a tile of the same kind (a reference for @imgN), then any.
  const tilesOf = new Map();
  for (const t of tags) if (t.kind === "file" && t.url) tilesOf.set(t.url, [...(tilesOf.get(t.url) || []), t.tag]);
  const family = (tag) => String(tag).toLowerCase().replace(/\d+$/, "");
  const tileFor = (key, urls) => {
    for (const u of urls) { const hit = (tilesOf.get(u) || []).find((t) => t.toLowerCase() === key); if (hit) return hit; }
    for (const u of urls) { const hit = (tilesOf.get(u) || []).find((t) => family(t) === family(key)); if (hit) return hit; }
    for (const u of urls) { const list = tilesOf.get(u); if (list?.length) return list[0]; }
    return null;
  };
  const current = new Map(tags.map((t) => [t.tag.toLowerCase(), t.tag]));
  // Elements by tag: the chosen ones by their tag now (a second "Alex" is char_alex_2),
  // the others by the tag they get once added, and every one by its own base tag.
  const byElementTag = new Map();
  const put = (k, e) => { const low = String(k || "").toLowerCase(); if (low && !byElementTag.has(low)) byElementTag.set(low, e); };
  const activeTags = elementTags(active);
  for (const e of active) put(activeTags.get(e.id), e);
  for (const e of candidates) if (!active.some((x) => x.id === e.id)) put(elementTags([...active, e]).get(e.id), e);
  for (const e of [...active, ...candidates]) put(elementTag(e), e);
  const elementOfUrl = (urls) => [...active, ...candidates].find((e) => (e.images || []).some((u) => urls.includes(u))) || null;
  const add = [];
  const added = new Map(); // url → its new tag
  const addElements = [];
  const unmatched = [];
  let next = refCount;
  const out = String(text).replace(TAG_RE, (all, pre, name) => {
    const key = canonicalTag(name);
    // An element tag adds the element (its pictures go with it), like a typed @ mention.
    // The pictures the answer meant say which element it is; the tag only when they don't.
    const el = IMAGE_TAG.test(key) ? null : elementOfUrl(meant.get(key) || []) || byElementTag.get(key);
    if (el) {
      const chosen = [...active, ...addElements];
      if (!chosen.some((x) => x.id === el.id)) {
        const why = canAdd(el, chosen.length);
        if (why) { unmatched.push({ tag: name, why }); return all; }
        addElements.push(el);
      }
      return `${pre}@${elementTags([...active, ...addElements]).get(el.id)}`;
    }
    const urls = meant.get(key);
    if (urls?.length) {
      const tile = tileFor(key, urls);
      if (tile) return `${pre}@${tile}`;
      for (const u of urls) if (added.has(u)) return `${pre}@${added.get(u)}`;
      if (IMAGE_TAG.test(key)) {
        next += 1;
        const tag = `img${next}`;
        add.push(urls[0]);
        added.set(urls[0], tag);
        return `${pre}@${tag}`;
      }
      unmatched.push({ tag: name, why: "the file is no longer attached" });
      return all;
    }
    if (current.has(key)) return `${pre}@${current.get(key)}`;
    if (IMAGE_TAG.test(key) || /^(vid|aud)\d+$/.test(key)) unmatched.push({ tag: name, why: "no picture has this tag" });
    return all;
  });
  return { text: out, add, addElements, unmatched };
}

// ── What a provider takes, in a few words (provider rows in the model menu) ──
// One phrase per endpoint, from the catalog: what goes together joins with " · ",
// endpoints that can't be combined join with " or ". "Frames · 4 refs" = one
// endpoint takes both; "Frames or 30 refs" = either one or the other.
// An endpoint that takes less than another one (text only, start frame only) is left out.
export function acceptsOf(entry) {
  if (!entry) return "";
  const covered = (a, b) => Object.entries(a.media).every(([r, m]) => b.media[r] && b.media[r].max >= m.max);
  const vs = entry.variants.filter((v) => Object.keys(v.media).length);
  const kept = vs.filter((v, i) => !vs.some((w, j) => j !== i && covered(v, w) && (!covered(w, v) || j < i)));
  const phrase = (m) => {
    const parts = [];
    if (m.first && m.last) parts.push("Frames");
    else if (m.first) parts.push("Start frame");
    else if (m.last) parts.push("End frame");
    if (m.source) parts.push("Edit video");
    const refs = [m.reference && `${m.reference.max} ${m.reference.max === 1 ? "ref" : "refs"}`, m.video && `${m.video.max} ${m.video.max === 1 ? "video" : "videos"}`, m.audio && `${m.audio.max} audio`].filter(Boolean);
    if (refs.length) parts.push(refs.join(", "));
    return parts.join(" · ");
  };
  // Frames first, then references, then video edit, whatever the catalog order.
  const rank = (m) => (m.source ? 2 : m.first || m.last ? 0 : 1);
  const out = uniq(kept.sort((a, b) => rank(a.media) - rank(b.media)).map((v) => phrase(v.media)).filter(Boolean));
  if (entry.canEdit && !out.length) out.push("Edits a picture");
  return out.length ? out.join(" or ") : entry.textOnly ? "Text only" : "";
}
