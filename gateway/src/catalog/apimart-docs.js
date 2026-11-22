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

function defaultOf(p) {
  const m = /\(default:\s*([^)]+)\)/i.exec(p.head) || /default[^`\n]{0,20}`([^`]+)`/i.exec(p.body.join('\n'));
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
      .flatMap((l) => (/^\s*[*-]\s+[A-Za-z ]+:\s*`/.test(l) ? ticks(l) : [ticks(l)[0]]))
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
  const valid = VALID[p.name];
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

function maxItemsOf(p) {
  const body = p.body.join('\n');
  const m = /(?:up to|maximum(?: of)?|max(?:imum)?|at most|no more than)\s*`?(\d+)`?/i.exec(body);
  return m ? Number(m[1]) : null;
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
    if (!params[key]) continue;
    const input = studioInput(key, params[key], names);
    if (input) inputs[key] = input;
  }
  if (params.negative_prompt && !inputs.negative_prompt) inputs.negative_prompt = { name: 'negative_prompt', title: 'Negative Prompt', type: 'string' };

  const media = {};
  if (params.first_frame_image) {
    media.image = { field: 'first_frame_image', max: 1, ...(params.last_frame_image ? { last: 'last_frame_image' } : {}) };
  } else if (params.image_with_roles && /`first_frame`/.test(text)) {
    // Seedance at APIMart: start and end frames only through `image_with_roles`
    // ({ url, role: first_frame | last_frame | reference_image }); `image_urls` are
    // references (2.0, 2.5) or frames by count (1.5). The studio sends its usual
    // start / end frame fields; toProviderBody turns them into roles.
    const urlsText = params.image_urls ? params.image_urls.body.join('\n') : '';
    const refs = !params.image_urls || /1 image\s*=\s*first frame/i.test(urlsText) ? 'never'
      : /cannot be used (simultaneously|together)/i.test(text) ? 'alone'
        : 'roles';
    const adaptive = /first[ /–-]*(last )?frame[^\n]*(`size`|aspect)[^\n]*adaptive/i.test(text);
    const roles = { field: 'image_with_roles', refs, ...(adaptive ? { adaptive: true } : {}) };
    media.image = refs === 'never'
      ? { field: 'first_frame_image', max: 1, last: 'last_frame_image', roles }
      : { field: 'image_urls', max: maxItemsOf(params.image_urls) || 4, first: 'first_frame_image', last: 'last_frame_image', roles };
  } else if (params.image_urls) {
    media.image = { field: 'image_urls', max: maxItemsOf(params.image_urls) || 4 };
  }
  const video = params.video_urls ? { field: 'video_urls', max: maxItemsOf(params.video_urls) || 1 } : params.video_url ? { field: 'video_url', max: 1 } : null;
  const audio = params.audio_urls ? { field: 'audio_urls', max: maxItemsOf(params.audio_urls) || 1 } : params.audio_url ? { field: 'audio_url', max: 1 } : null;
  return { ids, inputs, rename, media, video, audio, omniEdit: Boolean(params.omni_reference_task_type), title: (/^#\s+(.+)$/m.exec(text) || [])[1] };
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
      const common = { inputs: o.inputs };
      const modes = isVideo
        ? {
            t2v: { inputs: {} },
            ...(o.media.image ? { i2v: { inputs: {}, media: { image: o.media.image } } } : {}),
            ...(o.video ? { v2v: { inputs: {}, ...(o.omniEdit ? { fixed: { omni_reference_task_type: 'edit' } } : {}), media: { video: o.video, ...(o.media.image && o.media.image.roles?.refs !== 'never' ? { image: { field: o.media.image.field === 'image_urls' ? 'image_urls' : o.media.image.field, max: o.media.image.max } } : {}) } } } : {}),
          }
        : {
            t2i: { inputs: {} },
            ...(o.media.image ? { i2i: { inputs: {}, media: { image: o.media.image } } } : {}),
          };
      const score = Object.keys(o.inputs).length + Object.keys(modes).length;
      if (out[id] && out[id].score >= score) continue; // keep the most complete page (e.g. not "remix")
      out[id] = { source: url, docTitle: o.title, score, rename: o.rename, common, modes };
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
        // A page cut short keeps its title and model id but loses the parameters.
        if (!Object.keys(parseParams(text)).length) invalid += 1;
        docs.push({ url, text });
      } catch { failed += 1; }
    }
  }));
  docs.sort((a, b) => a.url.localeCompare(b.url)); // stable "most complete page" choice
  return { docs, total: urls.length, failed, invalid };
}
