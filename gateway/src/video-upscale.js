// Video upscaling: one tool, models from fal.ai and Atlas Cloud.
// One spec drives both sides: the studio draws its controls from it (sent as
// tools.videoUpscale), the gateway builds each provider's request and price.
//
// The user picks a target (1080p / 2K / 4K = short edge 1080 / 1440 / 2160);
// each model gets it in its own terms (a factor, a resolution name, a template).
//
// Sources (fetched 2026-11-18):
//   https://fal.ai/models/fal-ai/topaz/upscale/video/llms.txt
//   https://fal.ai/models/fal-ai/seedvr/upscale/video/llms.txt
//   https://fal.ai/models/fal-ai/flashvsr/upscale/video/llms.txt
//   Atlas input schemas: byteplus/video/upscaler, tencent/video/upscaler,
//   google/gemini-omni-1.2-flash/video-upscale, atlascloud/video-upscaler
//   (Atlas prices: exact, from its /model/calculate, which needs the video).
import { execFile } from 'node:child_process';
import fs from 'node:fs';

export const TARGETS = Object.freeze([
  { id: '1080p', label: '1080p', short: 1080 },
  { id: '2k', label: '2K', short: 1440 },
  { id: '4k', label: '4K', short: 2160 },
]);

const range = (key, label, { min = 0, max = 1, step = 0.01, def = null, start, hint } = {}) => ({ key, type: 'range', label, min, max, step, default: def, start: start ?? def ?? (min + max) / 2, hint });
const bool = (key, label, def, hint) => ({ key, type: 'bool', label, default: def, hint });
const select = (key, label, options, def, hint, labels) => ({ key, type: 'select', label, options, default: def, hint, labels });

const FPS = select('fps', 'Frame rate', ['keep', '30', '60'], 'keep', 'Higher frame rate adds in-between frames (smoother motion). 60 fps costs more.', { keep: 'Keep', 30: '30 fps', 60: '60 fps' });
const TOPAZ_FIELDS = [
  FPS,
  range('recover_detail', 'Recover detail', { hint: 'Higher keeps more of the original detail.' }),
  range('grain', 'Film grain', { max: 0.1, step: 0.01, start: 0.02, hint: 'Adds a little film grain back.' }),
];

// price.kind: 'topaz' (per second, by output height), 'mp' (per megapixel of
// all output frames), 'quote' (Atlas computes it from the video itself).
export const VIDEO_MODELS = Object.freeze([
  { id: 'topaz-starlight-precise', name: 'Topaz Starlight Precise 2.5', provider: 'fal', endpoint: 'fal-ai/topaz/upscale/video', topaz: 'Starlight Precise 2.5', targets: ['1080p', '2k', '4k'], hint: 'Most detail. Diffusion model: rebuilds texture faithfully. Best for AI shots.', price: { kind: 'topaz' }, fields: TOPAZ_FIELDS },
  { id: 'topaz-starlight-fast', name: 'Topaz Starlight Fast 2', provider: 'fal', endpoint: 'fal-ai/topaz/upscale/video', topaz: 'Starlight Fast 2', targets: ['1080p', '2k', '4k'], hint: 'Faster Starlight, a bit less detail.', price: { kind: 'topaz' }, fields: TOPAZ_FIELDS },
  { id: 'topaz-proteus', name: 'Topaz Proteus', provider: 'fal', endpoint: 'fal-ai/topaz/upscale/video', topaz: 'Proteus', targets: ['1080p', '2k', '4k'], hint: 'Classic Topaz: sharpens without inventing detail.', price: { kind: 'topaz' }, fields: TOPAZ_FIELDS },
  { id: 'topaz-gaia-2', name: 'Topaz Gaia 2', provider: 'fal', endpoint: 'fal-ai/topaz/upscale/video', topaz: 'Gaia 2', targets: ['1080p', '2k', '4k'], hint: 'For rendered / CG looks. Half the Topaz price.', price: { kind: 'topaz', half: true }, fields: TOPAZ_FIELDS },
  { id: 'seedvr2', name: 'SeedVR2', provider: 'fal', endpoint: 'fal-ai/seedvr/upscale/video', targets: ['1080p', '2k', '4k'], hint: 'ByteDance. Strong restoration, keeps motion steady. Priced per pixel.', price: { kind: 'mp', usd: 0.001 }, fields: [range('noise_scale', 'Noise', { def: 0.1, step: 0.01, hint: 'Higher lets the model change more.' })] },
  {
    id: 'flashvsr', name: 'FlashVSR', provider: 'fal', endpoint: 'fal-ai/flashvsr/upscale/video', targets: ['1080p', '2k', '4k'], hint: 'Fast and cheap; good for clean shots.', price: { kind: 'mp', usd: 0.0005 },
    fields: [
      select('acceleration', 'Speed', ['regular', 'high', 'full'], 'regular', 'Regular = best quality.', { regular: 'Regular', high: 'High', full: 'Full' }),
      bool('color_fix', 'Color fix', true, 'Keeps colors as in the original.'),
    ],
  },
  {
    id: 'byteplus', name: 'BytePlus Upscaler', provider: 'atlas', endpoint: 'byteplus/video/upscaler', targets: ['1080p', '2k', '4k'], hint: 'Cheapest. Has a mode for AI-generated video. Professional = top quality, ~5× the price.', price: { kind: 'quote' },
    fields: [
      select('tool_version', 'Engine', ['standard', 'professional'], 'standard', 'Professional runs 30+ algorithms: best quality, about 5× the price.', { standard: 'Standard', professional: 'Professional' }),
      { ...select('scene', 'Scene', ['aigc', 'common', 'short_series', 'ugc', 'old_film'], 'aigc', 'Tuning for the kind of video.', { aigc: 'AI video', common: 'General', short_series: 'Short drama', ugc: 'Phone video', old_film: 'Old film' }), when: { tool_version: 'standard' } },
      FPS,
    ],
  },
  {
    id: 'tencent', name: 'Tencent Upscaler', provider: 'atlas', endpoint: 'tencent/video/upscaler', targets: ['1080p', '2k', '4k'], hint: 'Has a preset tuned for Seedance 2 shots.', price: { kind: 'quote' },
    fields: [select('style', 'Preset', ['seedance2', 'live-action', 'anime', 'restore', 'live-action-smallface'], 'seedance2', 'What the video is.', { seedance2: 'Seedance 2 shot', 'live-action': 'Live action', anime: 'Anime', restore: 'Restore', 'live-action-smallface': 'Small faces' })],
  },
  { id: 'gemini-omni', name: 'Gemini Omni Upscale', provider: 'atlas', endpoint: 'google/gemini-omni-1.2-flash/video-upscale', targets: ['1080p', '4k'], hint: 'Made for Gemini Omni shots. Up to 15 s, 16:9 or 9:16, 720p → 1080p/4K.', price: { kind: 'quote' }, fields: [] },
  { id: 'atlascloud', name: 'AtlasCloud Upscaler', provider: 'atlas', endpoint: 'atlascloud/video-upscaler', targets: ['1080p', '2k'], hint: 'Simple and cheap, up to 2K.', price: { kind: 'quote' }, fields: [] },
]);

export const VIDEO_UPSCALE = Object.freeze({ id: 'videoUpscale', name: 'Upscale video', targets: TARGETS, models: VIDEO_MODELS });

export const VIDEO_TOOL_ENDPOINTS = Object.freeze({
  fal: [...new Set(VIDEO_MODELS.filter((m) => m.provider === 'fal').map((m) => m.endpoint))],
  atlas: [...new Set(VIDEO_MODELS.filter((m) => m.provider === 'atlas').map((m) => m.endpoint))],
});

export const isVideoUpscaleEndpoint = (providerId, endpoint) => Boolean(VIDEO_TOOL_ENDPOINTS[providerId]?.includes(endpoint));

// The spec for the studio: only models whose provider has a key.
export function videoUpscaleSpec(enabled) {
  const models = VIDEO_MODELS.filter((m) => enabled(m.provider));
  return models.length ? { ...VIDEO_UPSCALE, models } : null;
}

export class VideoUpscaleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Model chosen in the request (tool_model), belonging to this endpoint.
export function videoModelFor(providerId, endpoint, toolModel) {
  const list = VIDEO_MODELS.filter((m) => m.provider === providerId && m.endpoint === endpoint);
  return list.find((m) => m.id === toolModel) || list[0] || null;
}

// What the output will be: short edge = target, long edge scaled to match.
export function outputSize(info, targetId) {
  const t = TARGETS.find((x) => x.id === targetId) || TARGETS[0];
  const short = Math.min(info.width, info.height);
  const ratio = t.short / short;
  const w = info.width >= info.height ? Math.round(info.width * ratio) : t.short;
  const h = info.width >= info.height ? t.short : Math.round(info.height * ratio);
  return { width: w + (w % 2), height: h + (h % 2), ratio, short: t.short };
}

// Keeps only allowed values; validates what each model can take.
export function videoUpscaleBody(providerId, endpoint, body = {}, info = null) {
  const model = videoModelFor(providerId, endpoint, body.tool_model);
  if (!model) throw new VideoUpscaleError('Unknown upscale model.');
  const target = model.targets.includes(body.target) ? body.target : model.targets.includes('4k') ? '4k' : model.targets.at(-1);
  const pick = (key) => {
    const f = model.fields.find((x) => x.key === key);
    if (!f) return undefined;
    if (f.when && !Object.entries(f.when).every(([k, want]) => (body[k] ?? model.fields.find((x) => x.key === k)?.default) === want)) return undefined;
    const v = body[key];
    if (v === undefined || v === null || v === '') return f.default ?? undefined;
    if (f.type === 'range') { const n = Number(v); return Number.isFinite(n) ? clamp(n, f.min, f.max) : f.default ?? undefined; }
    if (f.type === 'bool') return v === true || v === 'true';
    if (f.type === 'select') return f.options.includes(String(v)) ? String(v) : f.default;
    return undefined;
  };
  const src = body.video_url;
  const fps = pick('fps');
  const out = { tool_model: model.id, target };
  if (info) {
    const short = Math.min(info.width, info.height);
    const t = TARGETS.find((x) => x.id === target);
    if (short >= t.short) throw new VideoUpscaleError(`This video is already ${short}p or more. Pick a bigger target.`);
  }
  const ratio = info ? TARGETS.find((x) => x.id === target).short / Math.min(info.width, info.height) : null;
  switch (model.id.startsWith('topaz-') ? 'topaz' : model.id) {
    case 'topaz': {
      const factor = ratio ? clamp(Math.round(ratio * 1000) / 1000, 1, 4) : 2;
      if (ratio && ratio > 4) throw new VideoUpscaleError('Topaz goes up to 4×. Pick a smaller target.');
      Object.assign(out, { video_url: src, model: model.topaz, upscale_factor: factor, H264_output: true });
      if (fps && fps !== 'keep') out.target_fps = Number(fps);
      for (const k of ['recover_detail', 'grain']) { const v = body[k]; if (v !== undefined && v !== null && v !== '') out[k] = pick(k); }
      break;
    }
    case 'seedvr2':
      Object.assign(out, { video_url: src, upscale_mode: 'target', target_resolution: { '1080p': '1080p', '2k': '1440p', '4k': '2160p' }[target], noise_scale: pick('noise_scale'), output_format: 'X264 (.mp4)', output_quality: 'high' });
      break;
    case 'flashvsr': {
      if (ratio && ratio > 4) throw new VideoUpscaleError('FlashVSR goes up to 4×. Pick a smaller target.');
      Object.assign(out, { video_url: src, upscale_factor: ratio ? clamp(Math.round(ratio * 1000) / 1000, 1, 4) : 2, acceleration: pick('acceleration'), color_fix: pick('color_fix'), preserve_audio: true, output_format: 'X264 (.mp4)', output_quality: 'high' });
      break;
    }
    case 'byteplus': {
      const version = pick('tool_version');
      Object.assign(out, { video_url: src, tool_version: version, resolution: target, bitrate_level: 'high' });
      if (version === 'standard') out.scene = pick('scene');
      if (fps && fps !== 'keep') out.fps = Number(fps);
      break;
    }
    case 'tencent':
      Object.assign(out, { video_url: src, template: `${pick('style')}-enhance-${target}`.replace('restore-enhance', 'restore').replace('smallface-enhance', 'smallface') });
      break;
    case 'gemini-omni':
      if (info) {
        const short = Math.min(info.width, info.height);
        const ar = info.width / info.height;
        if (info.duration > 15.05) throw new VideoUpscaleError('Gemini Omni Upscale takes videos up to 15 seconds.');
        if (Math.abs(ar - 16 / 9) > 0.03 && Math.abs(ar - 9 / 16) > 0.03) throw new VideoUpscaleError('Gemini Omni Upscale takes only 16:9 or 9:16 videos.');
        if (![360, 720, 1080].includes(short)) throw new VideoUpscaleError('Gemini Omni Upscale takes 360p, 720p or 1080p videos.');
        if (short === 360 && target === '4k') throw new VideoUpscaleError('From 360p Gemini Omni goes up to 1080p.');
      }
      Object.assign(out, { video: src, resolution: target });
      break;
    case 'atlascloud':
      Object.assign(out, { video: src, target_resolution: target });
      break;
    default:
      throw new VideoUpscaleError('Unknown upscale model.');
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// What goes to the provider: our own keys removed.
export function providerPayload(body) {
  const { tool_model: _m, target: _t, ...rest } = body;
  return rest;
}

// Price from published rates (fal). Atlas: null here — it is quoted from the video.
export function videoUpscalePrice(providerId, endpoint, body, info) {
  const model = videoModelFor(providerId, endpoint, body.tool_model);
  if (!model || !info || model.price.kind === 'quote') return null;
  const out = outputSize(info, body.target);
  if (model.price.kind === 'topaz') {
    const short = Math.min(out.width, out.height);
    let perSec = short <= 720 ? 0.01 : short <= 1080 ? 0.02 : 0.08;
    if (Number(body.target_fps) >= 50) perSec *= 2;
    if (model.price.half) perSec /= 2;
    return { usd: Math.round(perSec * info.duration * 1000) / 1000, exact: true, output: out };
  }
  const frames = info.frames || Math.round(info.duration * (info.fps || 24));
  const usd = (out.width * out.height * frames / 1e6) * model.price.usd;
  return { usd: Math.round(usd * 1000) / 1000, exact: true, output: out };
}

// Width, height, duration, fps, frames, audio — from ffprobe; kept per file version.
const infoCache = new Map();
export function videoInfo(file) {
  let st;
  try { st = fs.statSync(file); } catch { return Promise.resolve(null); }
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  if (infoCache.has(key)) return infoCache.get(key);
  const p = new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames:stream_side_data=rotation:format=duration', '-of', 'json', file], { timeout: 20_000 }, (error, stdout) => {
      if (error) { resolve(null); return; }
      try {
        const j = JSON.parse(stdout);
        const v = (j.streams || []).find((s) => s.codec_type === 'video');
        if (!v) { resolve(null); return; }
        const [a, b] = String(v.r_frame_rate || '24/1').split('/').map(Number);
        const fps = b ? a / b : a || 24;
        const duration = Number(j.format?.duration) || 0;
        const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation || 0)) % 180 === 90;
        resolve({
          width: rot ? v.height : v.width, height: rot ? v.width : v.height, fps: Math.round(fps * 100) / 100, duration,
          frames: Number(v.nb_frames) || Math.round(duration * fps), audio: (j.streams || []).some((s) => s.codec_type === 'audio'),
        });
      } catch { resolve(null); }
    });
  });
  infoCache.set(key, p);
  if (infoCache.size > 500) infoCache.delete(infoCache.keys().next().value);
  return p;
}

// The upscaled file lost the sound (most upscalers drop it): copy the
// original's audio back in, without re-encoding the picture.
export function restoreAudio(outputPath, sourcePath) {
  return new Promise((resolve) => {
    const tmp = `${outputPath}.audio.mp4`;
    execFile('ffmpeg', ['-v', 'error', '-y', '-i', outputPath, '-i', sourcePath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp], { timeout: 120_000 }, (error) => {
      if (error) { try { fs.unlinkSync(tmp); } catch { /* none */ } resolve(false); return; }
      try { fs.renameSync(tmp, outputPath); resolve(true); } catch { try { fs.unlinkSync(tmp); } catch { /* none */ } resolve(false); }
    });
  });
}
