// APIMart documentation → studio model specs (apimart-overrides.json).
// APIMart's API lists field names but not allowed values; the docs do
// ("Values: `16:9`, `9:16` …", "`4` ~ `30`"). Used by scripts/apimart-docs.mjs
// to build the bundled file, and by the gateway's daily check for changes.
import { providerFetch } from '../providers/http.js';

export const APIMART_DOCS_INDEX = 'https://docs.apimart.ai/_llms/en/api-manual.txt';
const DOC_URL = /https:\/\/docs\.apimart\.ai\/en\/api-reference\/(images|videos)\/[^\s)]+\.md/g;

const STOP = new Set(['true', 'false', 'null', 'auto_fix']);
const PARAM_LINE = /^\*\*([a-z0-9\\_]+)\*\*\s+`([^`]+)`([^\n]*)$/i;

// Splits the "Request parameters" part into { name: { type, head, body } }.
function parseParams(text) {
  const start = text.search(/^##\s+(Request parameters|Request body|Body parameters|Body|Parameters)\s*$/mi);
  if (start < 0) return {};
  const endRel = text.slice(start + 5).search(/^##\s+(Response|Responses|Example response|Errors|Query)/mi);
  const section = endRel < 0 ? text.slice(start) : text.slice(start, start + 5 + endRel);
  const params = {};
  let current = null;
  for (const line of section.split('\n')) {
    const m = PARAM_LINE.exec(line.trim());
    if (m) {
      const rawType = m[2].toLowerCase().replace(/\\/g, '');
      const type = /array|\[\]/.test(rawType) ? 'array' : rawType;
      current = { name: m[1].replace(/\\/g, ''), type, head: m[3], body: [] };
      if (!params[current.name]) params[current.name] = current;
      else current = { ...current, body: [] }; // later duplicates (examples) are ignored
      continue;
    }
    if (current) current.body.push(line);
  }
  return params;
}

const ticks = (s) => [...s.matchAll(/`([^`\n]{1,40})`/g)].map((m) => m[1].trim());
// "`1080p` returns HTTP 400", "`4k` is not supported", "`edit` and `extend` are unsupported":
// values named only to be refused.
const refusedIn = (text) => new Set(String(text).split(/(?<=[.;])\s+|\n/).filter((t) => /returns? (HTTP )?4\d\d|not supported|unsupported|not available|is rejected/i.test(t) && !/\bonly\b/i.test(t)).flatMap((t) => ticks(t)));
// "Alias for `duration`": the same setting under a second name (MAGI-2 `seconds`, `audio`) —
// never a setting of its own (both sent with different values → HTTP 400).
const aliasOf = (p, names) => { const m = /^\s*alias for `([a-z0-9_]+)`/im.exec([p.head, ...p.body].join('\n')); return m && names.has(m[1]) ? m[1] : null; };

function defaultOf(p) {
  const body = p.body.join('\n');
  // "(default: 5)" in the head; "`16:9` (default), `9:16` …" (MAGI-2: the value before the word,
  // not the one after it); "Default `auto`".
  const m = /\(default:\s*([^)]+)\)/i.exec(p.head) || /`([^`\n]+)`\s*\(default\)/i.exec(body) || /default[^`\n]{0,20}`([^`]+)`/i.exec(body);
  return m ? m[1].replace(/`/g, '').trim() : undefined;
}

const VALID = {
  aspect_ratio: /^(\d+:\d+|auto|adaptive|match_input)$/i,
  size: /^(\d+:\d+|auto|adaptive|\d+x\d+|\d+\*\d+|[124]K)$/i,
  resolution: /^(\d{3,4}p|\d(\.\d)?k|\d+x\d+|\d+\*\d+|standard|hd)$/i,
  output_format: /^(png|jpe?g|webp|gif|mp4|mov|webm)$/i,
};

function enumOf(p, otherNames) {
  const body = p.body.join('\n');
  // Prefer an explicit "Values:" / "Options:" line or a bullet list of values.
  const valuesLine = /(?:^|\n)\s*(?:Values|Options|Supported values|Allowed values|Available values|Supported)[^:\n]*:[ \t]*([^\n]+)/i.exec(body);
  let candidates = valuesLine ? ticks(valuesLine[1]) : [];
  if (candidates.length < 2) candidates = [];
  if (!candidates.length) {
    candidates = body.split('\n')
      .filter((l) => /^\s*[*-]\s+(`|[A-Za-z ]+:\s*`)/.test(l))
      // "* `21:9` / `16:9` / `4:3`": a bullet of values only gives them all (Wan 3.0 sizes).
      .flatMap((l) => (/^\s*[*-]\s+[A-Za-z ]+:\s*`/.test(l) || /^\s*[*-]\s+(`[^`]+`\s*(\/|,|or)?\s*){2,}$/.test(l) ? ticks(l) : [ticks(l)[0]]))
      .filter(Boolean);
  }
  if (!candidates.length) {
    // First paragraph, e.g. "Output resolution: `720p` or `1080p`."
    const para = body.trim().split(/\n\s*\n/)[0] || '';
    candidates = ticks(para);
  }
  if (!candidates.length) {
    const inline = /(?:only|one of|either)[^.\n]*?((?:`[^`]+`[,\s/or]*){2,})/i.exec(body);
    if (inline) candidates = ticks(inline[1]);
  }
  const refused = refusedIn(body);
  const valid = VALID[p.name];
  candidates = candidates.filter((v) => !refused.has(v));
  const values = candidates.filter((v) => !STOP.has(v) && !otherNames.has(v) && !/\s|@|\/\/|^-?\d+\s*~/.test(v) && v.length <= 20 && (!valid || valid.test(v)));
  return values.length >= 2 ? [...new Set(values)] : null;
}

function rangeOf(p) {
  const body = p.body.join('\n');
  const m = /`(-?\d+(?:\.\d+)?)`\s*(?:\\?~|–|-|to|through)\s*`(-?\d+(?:\.\d+)?)`/i.exec(body)
    || /from\s+`?(-?\d+(?:\.\d+)?)`?\s+to\s+`?(-?\d+(?:\.\d+)?)`?/i.exec(body)
    || /range[^0-9\n]*(-?\d+(?:\.\d+)?)\s*(?:-|–|~|to)\s*(-?\d+(?:\.\d+)?)/i.exec(body);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// "Up to 10", "Max **30** images", "Count: ≤ **9**", "Maximum 3 images".
const MAX_WORDS = /(?:up to|maximum(?: of)?|max(?:imum)?|at most|no more than|≤|<=)\s*[`*]{0,2}\s*(\d+)\s*[`*]{0,2}/i;
function maxItemsOf(p) {
  const m = MAX_WORDS.exec(p.body.join('\n'));
  return m ? Number(m[1]) : null;
}
// The limit stated next to a word ("up to 10 reference images"), else the first limit.
function maxNear(text, word) {
  for (const line of String(text || '').split('\n')) if (new RegExp(word, 'i').test(line)) { const m = MAX_WORDS.exec(line); if (m) return Number(m[1]); }
  return null;
}

function modelIdsOf(text, params) {
  const p = params.model;
  const ids = new Set();
  if (p) for (const v of ticks([p.head, ...p.body].join('\n'))) if (/^[A-Za-z0-9.\-_]+$/.test(v) && !STOP.has(v)) ids.add(v);
  for (const m of text.matchAll(/"model":\s*"([^"]+)"/g)) ids.add(m[1]);
  return [...ids];
}

const titled = (name) => name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function studioInput(name, p, otherNames, as = name) {
  const def = defaultOf(p);
  if (p.type === 'boolean') return { name: as, title: titled(as), type: 'boolean', default: def === 'true' };
  if (p.type === 'integer' || p.type === 'number') {
    const range = rangeOf(p);
    const values = enumOf(p, otherNames)?.map(Number).filter(Number.isFinite);
    if (values && values.length >= 2 && !range) return { name: as, title: titled(as), type: 'int', enum: values, default: values.includes(Number(def)) ? Number(def) : values[0] };
    if (!range) return null;
    const [lo, hi] = range[0] < 0 ? [Math.max(1, range[0]), range[1]] : range; // "-1 = auto" is not offered
    return { name: as, title: titled(as), type: p.type === 'integer' ? 'int' : 'number', minValue: lo, maxValue: hi, step: 1, default: Number.isFinite(Number(def)) ? Number(def) : lo };
  }
  const values = enumOf(p, otherNames);
  if (!values) return null;
  return { name: as, title: titled(as), type: 'string', enum: values, default: values.includes(def) ? def : values[0] };
}

const KEEP = ['resolution', 'duration', 'quality', 'n', 'generate_audio', 'audio', 'output_format', 'background', 'watermark', 'prompt_extend', 'prompt_optimizer', 'negative_prompt', 'mode', 'shot_type', 'generation_type'];

// ── Video inputs from the docs (every APIMart video model) ───────────────
// APIMart has one address per model; what a request is (frames, references, a video
// edit) is chosen by fields: first_frame_image / last_frame_image, image_with_roles
// roles, image_urls, video_urls, audio_urls, generation_type, omni_reference_task_type.
// This reads them into up to three studio endpoints:
//   i2v        start / end frame          (p/apimart/<id>?m=i2v)
//   reference  reference pictures, videos, audio  (?m=reference)
//   v2v        a video to edit (+ references)     (?m=v2v)
// Frames and references go in one endpoint only when the docs say they combine.
// What each wording means is written next to the rule; the audit script
// (scripts/provider-audit.mjs) compares the result with the docs again.
const FRAME_BY_COUNT = /first image is the (start|first) frame|image-to-video: the first image is the first frame|(one|1|single) image[^.\n]{0,60}(start(ing)?|first)[ -]frame|first image in `image_urls`|1 image\s*=\s*first frame/i;
const URLS_ARE_REFS = /regardless of count|all treated as `?reference|never auto-mapped to (first|frames)/i;
const COMBINE = /including (the )?first\/last frames|in total,? including (first|frames)/i;
const valuesOf = (p) => {
  if (!p) return [];
  const text = [p.head, ...p.body].join('\n');
  const refused = refusedIn(text);
  return ticks(text).filter((v) => /^[a-z_]+$/.test(v) && !refused.has(v));
};

function videoReader(params, text, ids) {
  const body = (n) => (params[n] ? params[n].body.join('\n') : '');
  const urls = body('image_urls');
  const rolesText = body('image_with_roles') + '\n' + (text.match(/`(first_frame|last_frame|reference_image|reference)`[^\n]*/g) || []).join('\n');
  const roleNames = new Set(params.image_with_roles ? [...rolesText.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]) : []);
  const typeValues = valuesOf(params.generation_type);
  const omni = valuesOf(params.omni_reference_task_type);
  // Per model in one page: "`veo3.1-lite` model does not support this parameter" (under a field),
  // "`veo3.1-quality` model does not support `reference` mode".
  const noField = (id, name) => new RegExp('`' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '` model does not support this parameter', 'i').test(body(name));
  const noMode = (id, mode) => new RegExp('`' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '` model does not support `' + mode + '` mode', 'i').test(text);

  return (rawId) => {
    // "veo3.1-lite-ext" is the same model as "veo3.1-lite": its rules apply too.
    const base = rawId.replace(/-ext$/, '');
    const id = base;
    const has = (n) => Boolean(params[n]) && !noField(id, n) && !noField(rawId, n);
    const modes = {};
    const bareIsFrame = has('image_urls') && FRAME_BY_COUNT.test(urls + '\n' + body('first_frame_image'));
    // Frames: their own fields, roles in image_with_roles, or image_urls with generation_type "frame" (Veo).
    const firstVia = has('first_frame_image') ? 'field' : roleNames.has('first_frame') ? 'roles'
      : has('image_urls') && typeValues.includes('frame') && !noMode(id, 'frame') ? 'list'
        : has('image_urls') && bareIsFrame && !has('image_with_roles') && !omni.includes('reference') ? 'list' : null;
    const lastVia = firstVia === 'list' ? (/second (image )?is the (end|last) frame|first and last frame|first\+last|2 images/i.test(urls + text) ? 'list' : null)
      : has('last_frame_image') ? 'field' : roleNames.has('last_frame') ? 'roles' : null;
    // References: bare image_urls when they are never frames; else with a role or a task type.
    const refRole = roleNames.has('reference_image') ? 'reference_image' : roleNames.has('reference') ? 'reference' : null;
    // In order: bare image_urls that are always references (H3); a type field that classifies
    // bare image_urls (Veo, Wan 3.0: generation_type "reference"); a role, when one bare
    // picture would be a start frame (Kling 4.0, Gemini Omni); a task type (omni "reference");
    // bare image_urls on a page where they are never frames; a role.
    let refsVia = null;
    if (has('image_urls') && URLS_ARE_REFS.test(urls)) refsVia = 'urls';
    else if (has('image_urls') && typeValues.includes('reference')) refsVia = noMode(id, 'reference') ? null : 'list';
    else if (bareIsFrame && refRole) refsVia = 'roles';
    else if (has('image_urls') && omni.includes('reference')) refsVia = 'urls-task';
    else if (has('image_urls') && !bareIsFrame && firstVia !== 'list') refsVia = 'urls';
    else if (refRole) refsVia = 'roles';
    // "up to 30 images + 10 videos + 10 audios" in the overview when the field says nothing.
    const overview = (word) => { const m = new RegExp(`(\\d+)\\s+(?:reference\\s+)?${word}`, 'i').exec(text); return m ? Number(m[1]) : null; };
    const refMax = (refsVia && (maxNear(urls, 'reference') || maxNear(rolesText, 'reference') || maxItemsOf(params.image_urls || { body: [] }) || overview('images'))) || 4;
    const videoRefs = has('video_urls') && /reference/i.test(body('video_urls')) ? { field: 'reference_videos', provider: 'video_urls', max: maxItemsOf(params.video_urls) || maxNear(body('video_urls'), 'video|clip') || overview('videos') || 1 } : null;
    const audioRefs = has('audio_urls') ? { field: 'reference_audios', provider: 'audio_urls', max: maxItemsOf(params.audio_urls) || overview('audios') || 1 } : null;
    const together = Boolean(firstVia && refsVia) && COMBINE.test(text);

    const frames = firstVia ? { via: firstVia, last: Boolean(lastVia) } : null;
    if (frames && !together) modes.i2v = { frames };
    const refs = refsVia || videoRefs || audioRefs ? { via: refsVia, max: refMax, refRole, video: videoRefs, audio: audioRefs } : null;
    if (refs && !together) modes.reference = { refs };
    if (together) modes.i2v = { frames, refs };
    // A video to edit: omni_reference_task_type "edit" with a video field (Kling: video_url,
    // Seedance: video_urls), or a page about editing / remixing with one video.
    const editField = has('video_url') ? 'video_url' : has('video_urls') ? 'video_urls' : null;
    if (editField && (omni.includes('edit') || (!videoRefs && /edit|remix|restyle|video-to-video/i.test(text)))) {
      modes.v2v = { edit: { field: editField, task: omni.includes('edit') ? 'edit' : null }, refs: refsVia ? { via: refsVia === 'urls-task' ? 'urls' : refsVia, max: refMax, refRole } : null };
    }
    // Per mode, from the docs' own words:
    //  prompt: "*required*", or "Optional for image-to-video; required otherwise" (Kling);
    const promptText = [params.prompt?.head || '', body('prompt')].join('\n');
    const promptReq = /\*required\*|\brequired\b/i.test(params.prompt?.head || '') ? 'all' : /optional for image-to-video;? required otherwise/i.test(promptText) ? 'not-i2v' : null;
    //  aspect ratio: "Image-to-video does not accept `aspect_ratio`" (Kling 4.0 Flash: 400);
    const ar = body('aspect_ratio') + body('size');
    const i2vNoRatio = /image-to-video (does not accept|do not send|must not)[^.\n]*(`aspect_ratio`|`size`)/i.test(ar);
    //  edit: "`size` must be `adaptive`, `duration` must be `-1`" (Seedance);
    const editFixed = /edit[^\n]*`size` must be `adaptive`[^\n]*`duration` must be `-1`/i.test(text);
    //  audio: "Cannot be used alone" (H3) — with a reference picture or video;
    const audioNeeds = /cannot be used alone|audio alone is not allowed/i.test(body('audio_urls') + text);
    //  totals: "no more than 15 assets combined" (Kling), "Up to 10 images in total, including first/last frames" (Gemini).
    const assetsTotal = Number((/no more than\s+\**(\d+)\**\s+assets/i.exec(text) || [])[1]) || null;
    const imagesTotal = Number((/(?:up to|no more than)\s+\**(\d+)\**\s+images in total,? including (?:the )?first/i.exec(text) || [])[1]) || null;
    //  aspect ratio by mode: "use `auto` to follow the first frame's aspect ratio" (only with a
    //  start frame); "Image-to-video supports the first five ratios, excluding `21:9`" (MAGI-2).
    const ratioAutoIsFrame = /`auto`[^.\n]*first[ -]frame/i.test(ar);
    const i2vExcl = /image-to-video[^.\n]*?excluding\s+((?:`[^`]+`[\s,]*(?:and|or)?\s*)+)/i.exec(ar);
    const i2vRatioExclude = i2vExcl ? ticks(i2vExcl[1]) : [];
    return {
      ratioAutoIsFrame, i2vRatioExclude,
      modes, omniRef: omni.includes('reference'), typeField: params.generation_type && has('generation_type') ? 'generation_type' : null,
      adaptive: /first[ /–-]*(last )?frame[^\n]*(`size`|aspect)[^\n]*adaptive/i.test(text),
      promptReq, i2vNoRatio, editFixed, audioNeeds, assetsTotal, imagesTotal,
      // Fields this model in a shared page doesn't take ("`veo3.1-lite` model does not support this parameter").
      noFields: Object.keys(params).filter((n) => !has(n)),
    };
  };
}

// The reader's result → override modes (build.js: buildApimartVariants).
function videoModes(read) {
  const out = { t2v: { inputs: {}, ...(read.promptReq ? { promptRequired: true } : {}) } };
  const rolesSpec = (extra) => ({ field: 'image_with_roles', ...(read.typeField ? { typeField: read.typeField } : {}), ...extra });
  for (const [mode, m] of Object.entries(read.modes)) {
    const media = {};
    const rename = {};
    const fixed = {};
    let roles = null;
    if (m.frames) {
      media.image = { field: 'first_frame_image', max: 1, ...(m.frames.last ? { last: 'last_frame_image' } : {}) };
      if (m.frames.via === 'roles') roles = rolesSpec({ frames: 'roles' });
      if (m.frames.via === 'list') roles = { field: 'image_urls', frames: 'list', ...(read.typeField ? { typeField: read.typeField } : {}) };
      if (read.adaptive) roles = { ...(roles || { frames: 'fields' }), adaptive: true };
    }
    if (m.refs) {
      if (m.refs.via) {
        const refs = { field: 'image_urls', max: m.refs.max };
        if (media.image) media.image = { ...media.image, refsField: 'image_urls', refsMax: m.refs.max };
        else media.image = refs;
        if (m.refs.via === 'roles') roles = { ...(roles || rolesSpec({})), refs: 'roles', refRole: m.refs.refRole, always: true };
        if (m.refs.via === 'list') roles = { ...(roles || {}), field: roles?.field || 'image_urls', refs: 'list', typeField: read.typeField };
        if ((m.refs.via === 'urls-task' || read.omniRef) && !m.frames && !m.edit) fixed.omni_reference_task_type = 'reference';
      }
      if (m.refs.video) { media.video = { field: m.refs.video.field, max: m.refs.video.max }; rename[m.refs.video.field] = m.refs.video.provider; }
      if (m.refs.audio) { media.audio = { field: m.refs.audio.field, max: m.refs.audio.max }; rename[m.refs.audio.field] = m.refs.audio.provider; }
    }
    if (m.edit) {
      media.video = { field: m.edit.field, max: 1 };
      if (m.edit.task) fixed.omni_reference_task_type = m.edit.task;
      if (m.refs) {
        media.image = { field: 'image_urls', max: m.refs.max };
        if (m.refs.via === 'roles') roles = { field: 'image_with_roles', refs: 'roles', refRole: m.refs.refRole, always: true };
      }
    }
    if (m.edit && read.editFixed) { fixed.size = 'adaptive'; fixed.duration = -1; }
    const checks = {
      ...(read.audioNeeds && media.audio ? { audioNeeds: media.audio.field } : {}),
      ...(read.assetsTotal && mode === 'reference' ? { assetsTotal: read.assetsTotal } : {}),
      ...(read.imagesTotal && m.frames && m.refs ? { imagesTotal: read.imagesTotal } : {}),
    };
    out[mode] = {
      inputs: {}, media,
      ...(read.promptReq === 'all' || (read.promptReq === 'not-i2v' && mode !== 'i2v') ? { promptRequired: true } : {}),
      ...(mode === 'i2v' && read.i2vNoRatio ? { omit: ['aspect_ratio'] } : {}),
      ...(m.edit && read.editFixed ? { omit: ['aspect_ratio', 'duration'] } : {}),
      ...(Object.keys(checks).length ? { checks } : {}),
      ...(roles ? { roles } : {}), ...(Object.keys(rename).length ? { rename } : {}), ...(Object.keys(fixed).length ? { fixed } : {}),
    };
  }
  return out;
}

function buildOverride(text) {
  const params = parseParams(text);
  const names = new Set(Object.keys(params));
  const ids = modelIdsOf(text, params);
  if (!ids.length) return null;
  const inputs = {};
  const rename = {};

  // Aspect ratio: APIMart calls it "size" (images, Seedance) or "aspect_ratio".
  const arParam = params.aspect_ratio || params.size;
  if (arParam) {
    const input = studioInput(arParam.name, arParam, names, 'aspect_ratio');
    if (input && input.enum?.every((v) => /^(\d+:\d+|auto|adaptive|match_input)$/i.test(v))) {
      inputs.aspect_ratio = input;
      if (arParam.name === 'size') rename.aspect_ratio = 'size';
      else rename.aspect_ratio = 'aspect_ratio';
    }
  }
  for (const key of KEEP) {
    if (!params[key] || aliasOf(params[key], names)) continue;
    const input = studioInput(key, params[key], names);
    if (input) inputs[key] = input;
  }
  if (params.negative_prompt && !inputs.negative_prompt) inputs.negative_prompt = { name: 'negative_prompt', title: 'Negative Prompt', type: 'string' };

  const media = {};
  // Frame roles only where the docs were read and the request checked (Seedance, Gemini Omni,
  // Wan 3.0): other docs mention `first_frame` with other meanings (Wan 2.7: one bare picture
  // is the start frame; Wan 2.7 R2V: references only).
  const rolesChecked = ids.some((id) => /seedance|gemini-omni|wan3\.0/i.test(id));
  // Gemini Omni at APIMart: one bare picture in `image_urls` is a start frame, several are
  // subject references. Frames and references all go through `image_with_roles`, so one
  // reference is never read as a start frame (toProviderBody → withRoles, `always`).
  if (rolesChecked && params.first_frame_image && params.image_urls && params.image_with_roles && /multiple images[^\n]*references/i.test(text)) {
    const refRole = /`reference`\s*:/.test(text) ? 'reference' : 'reference_image';
    media.image = {
      field: 'image_urls', max: maxItemsOf(params.image_urls) || 10, first: 'first_frame_image',
      ...(params.last_frame_image ? { last: 'last_frame_image' } : {}),
      roles: { field: 'image_with_roles', refs: 'roles', refRole, always: true },
    };
  } else if (params.first_frame_image) {
    media.image = { field: 'first_frame_image', max: 1, ...(params.last_frame_image ? { last: 'last_frame_image' } : {}) };
  } else if (rolesChecked && params.image_with_roles && /`first_frame`/.test(text)) {
    // Seedance at APIMart: start and end frames only through `image_with_roles`
    // ({ url, role: first_frame | last_frame | reference_image }); `image_urls` are
    // references (2.0, 2.5) or frames by count (1.5). The studio sends its usual
    // start / end frame fields; toProviderBody turns them into roles.
    const urlsText = params.image_urls ? params.image_urls.body.join('\n') : '';
    // Seedance (every version): frames and references never in one request, whatever the docs
    // say. Checked 23.11.2026 on APIMart 2.5: "first/last frame content cannot be mixed with
    // reference media content" (async failure, refunded). Atlas splits them into two endpoints too.
    const refs = !params.image_urls || /1 image\s*=\s*first frame/i.test(urlsText) ? 'never'
      : ids.some((id) => /seedance/i.test(id)) || /cannot be used (simultaneously|together)|mutual exclusion rules|reference mode is mutually exclusive/i.test(text) ? 'alone'
        : 'roles';
    const adaptive = /first[ /–-]*(last )?frame[^\n]*(`size`|aspect)[^\n]*adaptive/i.test(text);
    // Wan 3.0: one bare picture counts as a start frame (`generation_type` decides otherwise),
    // so references always go with their role.
    const always = Boolean(params.generation_type);
    const roles = { field: 'image_with_roles', refs, ...(adaptive ? { adaptive: true } : {}), ...(always ? { always: true, typeField: 'generation_type' } : {}) };
    media.image = refs === 'never'
      ? { field: 'first_frame_image', max: 1, last: 'last_frame_image', roles }
      : { field: 'image_urls', max: maxItemsOf(params.image_urls) || 4, first: 'first_frame_image', last: 'last_frame_image', roles };
  } else if (params.image_urls) {
    media.image = { field: 'image_urls', max: maxItemsOf(params.image_urls) || 4 };
  }
  const video = params.video_urls ? { field: 'video_urls', max: maxItemsOf(params.video_urls) || 1 } : params.video_url ? { field: 'video_url', max: 1 } : null;
  const audio = params.audio_urls ? { field: 'audio_urls', max: maxItemsOf(params.audio_urls) || 1 } : params.audio_url ? { field: 'audio_url', max: 1 } : null;
  // How the prompt names references ("use `@Image1`, `@Video1`…"): the studio writes tags that way.
  const refSyntax = /`@Image1`/.test(text) ? 'ImageN' : /`@image_1`/.test(text) ? 'image_N' : /`@image1`/.test(text) ? 'imageN' : null;
  return { ids, inputs, rename, media, video, audio, refSyntax, readVideo: videoReader(params, text, ids), title: (/^#\s+(.+)$/m.exec(text) || [])[1] };
}


// The aspect ratios one mode takes, when the docs narrow them per mode (MAGI-2: `auto` only
// with a start frame, where it is the default; no `21:9` from a start frame).
function ratioByMode(ar, modes, read) {
  if (!ar?.enum || (!read.ratioAutoIsFrame && !read.i2vRatioExclude.length)) return;
  for (const [mode, spec] of Object.entries(modes)) {
    const frames = mode === 'i2v' && spec.media?.image?.field === 'first_frame_image';
    let values = ar.enum;
    if (read.ratioAutoIsFrame && !frames) values = values.filter((v) => v !== 'auto');
    if (frames) values = values.filter((v) => !read.i2vRatioExclude.includes(v));
    if (values.length === ar.enum.length || values.length < 2) continue;
    const def = frames && values.includes('auto') ? 'auto' : values.includes(ar.default) ? ar.default : values[0];
    spec.inputs = { ...spec.inputs, aspect_ratio: { ...ar, enum: values, default: def } };
  }
}

// [{ url, text }] → { modelId: { source, docTitle, score, rename, common, modes } }
export function buildApimartOverrides(docs) {
  const out = {};
  for (const { url, text } of docs) {
    if (!/generation|video|image/i.test(url)) continue;
    const o = buildOverride(text);
    if (!o) continue;
    for (const id of o.ids) {
      const isVideo = /\/videos\/|videos__/.test(url);
      const read = isVideo ? o.readVideo(id) : null;
      // A shared page: inputs this model doesn't take are left out (Veo 3.1 Lite: generation_type).
      const common = { inputs: read ? Object.fromEntries(Object.entries(o.inputs).filter(([k]) => !read.noFields.includes(k) && !read.noFields.includes(o.rename?.[k]))) : o.inputs };
      const modes = isVideo
        ? videoModes(read)
        : {
            t2i: { inputs: {} },
            ...(o.media.image ? { i2i: { inputs: {}, media: { image: o.media.image } } } : {}),
          };
      if (read) ratioByMode(common.inputs.aspect_ratio, modes, read);
      const score = Object.keys(o.inputs).length + Object.keys(modes).length;
      if (out[id] && out[id].score >= score) continue; // keep the most complete page (e.g. not "remix")
      // Video modes come from the docs alone (APIMart's tags are sometimes wrong: Veo 3.1 Lite
      // is tagged image-to-video but takes no pictures).
      out[id] = { source: url, docTitle: o.title, score, rename: o.rename, common, modes, ...(isVideo ? { onlyModes: true } : {}), ...(o.refSyntax ? { refSyntax: o.refSyntax } : {}) };
    }
  }
  return out;
}

// Fetches the index and every image/video generation page.
export async function fetchApimartDocs({ fetchFn = (url) => providerFetch(url, { timeoutMs: 20_000, redirect: 'error' }), concurrency = 6 } = {}) {
  const indexResponse = await fetchFn(APIMART_DOCS_INDEX);
  if (!indexResponse.ok) throw new Error(`APIMart docs index: HTTP ${indexResponse.status}`);
  const index = await indexResponse.text();
  const urls = [...new Set(index.match(DOC_URL) || [])];
  const docs = [];
  let i = 0;
  let failed = 0;
  let invalid = 0; // pages without a readable parameter list (a few are normal: guides, query pages)
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const r = await fetchFn(url);
        if (!r.ok) { failed += 1; continue; }
        const text = await r.text();
        // A page cut short keeps its title and model id (the examples come first) but loses the
        // parameters. Pages that name no model are guides or button pages (Midjourney's upscale,
        // pan, zoom …, added 17.11: 19 of them blocked every docs check for 9 days) — not counted.
        if (!Object.keys(parseParams(text)).length && modelIdsOf(text, {}).length) invalid += 1;
        docs.push({ url, text });
      } catch { failed += 1; }
    }
  }));
  docs.sort((a, b) => a.url.localeCompare(b.url)); // stable "most complete page" choice
  return { docs, total: urls.length, failed, invalid };
}
