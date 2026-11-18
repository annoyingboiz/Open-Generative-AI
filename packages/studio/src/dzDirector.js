// DZ: AI Director — storyboards on the server and the two requests of a shot
// (start frame with an image model → that frame animated by a video model),
// built with the same engine as Create (dzCreate.js).
import {
  chooseVariant, missingFor, buildBody, keepValues, paramsOf, refSyntaxFor, composePrompt,
  promptTags, translateTags, mergeElements, elementsInputOf, klingElementPairs, elementTags, DEFAULT_CAMERA,
} from "./dzCreate.js";

async function call(method, url, body) {
  const res = await fetch(url, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.storyboard = data.storyboard || null;
    throw err;
  }
  return data;
}
const enc = encodeURIComponent;
export const dzStoryboards = {
  list: (project) => call("GET", `/dz/api/storyboards${project ? `?project=${enc(project)}` : ""}`),
  create: (data) => call("POST", "/dz/api/storyboards", data),
  get: (id) => call("GET", `/dz/api/storyboards/${enc(id)}`),
  update: (id, data) => call("PATCH", `/dz/api/storyboards/${enc(id)}`, data),
  remove: (id) => call("DELETE", `/dz/api/storyboards/${enc(id)}`),
  media: (id, data) => call("POST", `/dz/api/storyboards/${enc(id)}/media`, data),
  plan: (id, data) => call("POST", `/dz/api/storyboards/${enc(id)}/plan`, data),
};

export const SHOT_SIZES = ["extreme wide", "wide", "full", "medium wide", "medium", "medium close-up", "close-up", "extreme close-up", "insert"];
export const SHOT_ANGLES = ["eye level", "low angle", "high angle", "overhead", "dutch angle", "POV", "over the shoulder"];

export const newShotId = () => `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
export const emptyShot = () => ({ id: newShotId(), title: "", size: "medium", angle: "eye level", camera: null, lens: null, focal: null, aperture: null, move: "static", light: "", action: "", frame_prompt: "", motion_prompt: "", duration: null });

// The video model's durations: a list of allowed values or a range.
export function durationsOf(variant) {
  const p = variant ? [...paramsOf(variant.model).main, ...paramsOf(variant.model).advanced].find((x) => x.key === "duration") : null;
  if (!p) return { list: [], range: null, param: null };
  if (Array.isArray(p.enum)) return { list: p.enum.map(Number).filter((n) => Number.isFinite(n) && n > 0), range: null, param: p };
  if (p.minValue != null && p.maxValue != null) return { list: [], range: { min: Number(p.minValue), max: Number(p.maxValue) }, param: p };
  return { list: [], range: null, param: p };
}
// A shot's duration as this model takes it (nearest allowed value / within range).
export function fitDuration(d, dur) {
  if (d == null || !Number.isFinite(Number(d))) return undefined;
  const n = Number(d);
  if (dur.list.length) return dur.list.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), dur.list[0]);
  if (dur.range) return Math.min(dur.range.max, Math.max(dur.range.min, Math.round(n)));
  return undefined;
}

// The camera of a shot: its own presets over the storyboard's look.
export const shotCamera = (shot, look = {}) => ({
  ...DEFAULT_CAMERA,
  on: true,
  camera: shot.camera || look.camera || DEFAULT_CAMERA.camera,
  lens: shot.lens || look.lens || DEFAULT_CAMERA.lens,
  focal: shot.focal || look.focal || DEFAULT_CAMERA.focal,
  aperture: shot.aperture || look.aperture || DEFAULT_CAMERA.aperture,
});

// One request: the variant, the body, or why it can't run yet.
function request(entry, kind, { prompt, values, attached, elements, camera, move }) {
  if (!entry) return { problem: "Choose a model." };
  const merged = mergeElements(entry, attached, elements);
  const variant = chooseVariant(entry, merged.attached, { native: merged.native });
  if (!variant) return { problem: `${entry.familyName} can't take these files together.` };
  const spec = elementsInputOf(variant.model);
  const pairs = spec ? klingElementPairs(elements, spec) : [];
  const syntax = refSyntaxFor(variant.model);
  const tags = promptTags({ attached: merged.attached, syntax, elements, elementPairs: pairs, variant });
  const finalPrompt = composePrompt(translateTags(prompt, tags), { kind, camera, move });
  const vals = keepValues(values || {}, variant);
  const problem = missingFor(variant, merged.attached);
  if (problem) return { problem, variant };
  if (variant.model.promptRequired && !String(prompt || "").trim()) return { problem: "Write the prompt first.", variant };
  const body = buildBody(variant, { prompt: finalPrompt, values: vals, attached: merged.attached, elements: spec ? elements : [] });
  return { variant, body, trimmed: merged.trimmed, prompt: finalPrompt };
}

export function frameRequest({ entry, shot, look, values, elements }) {
  return request(entry, "image", { prompt: shot.frame_prompt || shot.action, values, attached: {}, elements, camera: shotCamera(shot, look), move: "" });
}

export function videoRequest({ entry, shot, values, frame, dur }) {
  if (!frame) return { problem: "Pick a start frame first." };
  const d = fitDuration(shot.duration, dur);
  const vals = { ...(values || {}), ...(d != null && dur.param ? { duration: d } : {}) };
  return request(entry, "video", { prompt: shot.motion_prompt || shot.action, values: vals, attached: { first: [{ url: frame, name: "frame" }] }, elements: [], camera: null, move: shot.move || "" });
}

// Elements for the Director: their tags, as the frame prompts use them.
export function elementRefs(elements) {
  const tags = elementTags(elements);
  return elements.map((e) => ({ tag: tags.get(e.id), label: `${e.name} (${e.kind || "element"})`, description: e.description || "" }));
}
