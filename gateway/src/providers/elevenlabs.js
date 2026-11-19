// ElevenLabs (https://elevenlabs.io) on your own account: its key, its plan's
// credits, its voices — including your own cloned ones, which only work with
// your key (Atlas forwards a voice id, but its ElevenLabs account can't use a
// private voice of yours). Docs: https://elevenlabs.io/docs/api-reference
//
// Speech, the voice changer and sound effects answer at once with the audio:
// it is saved here at submit and the job is "done" on its first check (same as
// APIMart speech). Transcription (Scribe) answers with text, so it is its own
// call (transcribe), not a library item.
import fs from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import { providerJson, providerFetch, ProviderHttpError, fileForm } from './http.js';

let API = 'https://api.elevenlabs.io';
// Tests point it at a stand-in server.
export function setElevenlabsApiForTests(url) { API = url; }
const auth = (apiKey) => ({ 'xi-api-key': apiKey });

let dir = null;
export function configureElevenlabsFiles(folder) { dir = folder || null; }
const OUT_RE = /^elevenlabs-file:([A-Za-z0-9-]{36}\.mp3)$/;
const IN_RE = /^elevenlabs-in:([A-Za-z0-9_-]{16,40}\.(mp3|wav|m4a|aac|ogg|webm|mp4|mov|flac))$/;
const OUTPUT = 'mp3_44100_128';
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', mp4: 'video/mp4', mov: 'video/quicktime' };

// What each of our model ids does at ElevenLabs. TTS ids are the provider's own
// (eleven_v4…); the voice changer and sound effects have one model each.
export const ELEVEN_TOOLS = {
  'voice-changer': { path: (voice) => `/v1/speech-to-speech/${encodeURIComponent(voice)}`, model: 'eleven_multilingual_sts_v2', input: 'audio' },
  'sound-effects': { path: () => '/v1/sound-generation', model: 'eleven_text_to_sound_v3' },
};

async function audioOrError(response, what) {
  const type = String(response.headers.get('content-type') || '');
  if (!response.ok || /json|text\//i.test(type)) {
    const text = await response.text();
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      const d = j.detail;
      detail = (typeof d === 'string' ? d : d?.message || d?.status) || j.message || detail;
    } catch { /* plain text */ }
    throw new ProviderHttpError(`ElevenLabs ${what}: HTTP ${response.status}: ${detail}`, { status: response.ok ? 502 : response.status });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 200 * 1024 * 1024) throw new Error(`ElevenLabs ${what}: empty or oversized audio`);
  return buffer;
}

async function save(buffer) {
  if (!dir) throw new Error('ElevenLabs: no folder for results');
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.mp3`;
  await fs.promises.writeFile(nodePath.join(dir, name), buffer);
  return { taskId: `file:${name}` };
}

// Our sliders → ElevenLabs voice_settings (only what was set).
function voiceSettings(body) {
  const out = {};
  for (const k of ['stability', 'similarity_boost', 'style', 'speed']) if (Number.isFinite(Number(body[k])) && body[k] !== '' && body[k] != null) out[k] = Number(body[k]);
  if (typeof body.use_speaker_boost === 'boolean') out.use_speaker_boost = body.use_speaker_boost;
  return Object.keys(out).length ? out : undefined;
}

function inputFile(ref) {
  const m = IN_RE.exec(String(ref || ''));
  if (!m || !dir) throw Object.assign(new Error('The recording did not reach ElevenLabs.'), { status: 400 });
  return nodePath.join(dir, 'in', m[1]);
}

export const elevenlabs = {
  id: 'elevenlabs',
  name: 'ElevenLabs',
  website: 'https://elevenlabs.io',
  keysUrl: 'https://elevenlabs.io/app/settings/api-keys',

  // Your plan: credits left this period (shown as the balance).
  async balance({ apiKey, proxy }) {
    const s = await providerJson(`${API}/v1/user/subscription`, { proxy, headers: auth(apiKey), timeoutMs: 20_000 });
    const left = Number(s?.character_limit) - Number(s?.character_count);
    if (!Number.isFinite(left)) throw new Error('Unexpected subscription response from ElevenLabs');
    return { amount: left, currency: 'CREDITS', tier: s.tier || null, limit: Number(s.character_limit) || null, resetsAt: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : null };
  },

  // The models your key can use (GET /v1/models).
  async listModels({ apiKey, proxy }) {
    const data = await providerJson(`${API}/v1/models`, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
    return Array.isArray(data) ? data : [];
  },

  // Your voices: your own (cloned, designed, professional) first, then the premade ones.
  async voices({ apiKey, proxy }) {
    const out = [];
    let token = '';
    for (let page = 0; page < 5; page += 1) {
      const u = new URL(`${API}/v2/voices`);
      u.searchParams.set('page_size', '100');
      if (token) u.searchParams.set('next_page_token', token);
      const data = await providerJson(u.href, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
      for (const v of data?.voices || []) {
        if (!v?.voice_id) continue;
        out.push({ id: v.voice_id, name: String(v.name || v.voice_id).slice(0, 60), category: v.category || '', labels: v.labels || {}, preview: v.preview_url || null });
      }
      if (!data?.has_more || !data?.next_page_token) break;
      token = data.next_page_token;
    }
    return out;
  },

  async submit({ apiKey, proxy }, { model, body }) {
    const tool = ELEVEN_TOOLS[model];
    if (tool?.input === 'audio') {
      if (!body.voice_id) throw Object.assign(new Error('Choose a voice.'), { status: 400 });
      const file = inputFile(body.audio);
      const ext = nodePath.extname(file).slice(1);
      const form = await fileForm('audio', file, MIME[ext] || 'application/octet-stream', nodePath.basename(file));
      form.append('model_id', tool.model);
      if (body.remove_background_noise === true) form.append('remove_background_noise', 'true');
      const vs = voiceSettings(body);
      if (vs) form.append('voice_settings', JSON.stringify(vs));
      const response = await providerFetch(`${API}${tool.path(body.voice_id)}?output_format=${OUTPUT}`, { proxy, method: 'POST', headers: auth(apiKey), body: form, timeoutMs: 300_000 });
      // The copy stays for a day (it may be reused for the next request); swept after.
      return save(await audioOrError(response, 'voice changer'));
    }
    if (tool) {
      const payload = { text: body.text, model_id: tool.model };
      if (Number(body.duration_seconds) > 0) payload.duration_seconds = Number(body.duration_seconds);
      if (Number.isFinite(Number(body.prompt_influence)) && body.prompt_influence !== '' && body.prompt_influence != null) payload.prompt_influence = Number(body.prompt_influence);
      if (body.loop === true) payload.loop = true;
      const response = await providerFetch(`${API}${tool.path()}?output_format=${OUTPUT}`, {
        proxy, method: 'POST', headers: { ...auth(apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 180_000,
      });
      return save(await audioOrError(response, 'sound effects'));
    }
    // Text to speech with one of your voices.
    if (!body.voice_id) throw Object.assign(new Error('Choose a voice.'), { status: 400 });
    if (!String(body.text || '').trim()) throw Object.assign(new Error('Write the text to speak.'), { status: 400 });
    const payload = { text: body.text, model_id: model };
    const vs = voiceSettings(body);
    if (vs) payload.voice_settings = vs;
    if (Number.isInteger(Number(body.seed)) && body.seed !== '' && body.seed != null) payload.seed = Number(body.seed);
    if (body.language_code) payload.language_code = String(body.language_code);
    const response = await providerFetch(`${API}/v1/text-to-speech/${encodeURIComponent(body.voice_id)}?output_format=${OUTPUT}`, {
      proxy, method: 'POST', headers: { ...auth(apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 180_000,
    });
    return save(await audioOrError(response, 'speech'));
  },

  // Everything is done at submit.
  async poll(cfg, taskId) {
    const m = /^file:(.+)$/.exec(String(taskId || ''));
    if (!m) return { state: 'failed', error: 'Unknown ElevenLabs job.' };
    return { state: 'completed', outputs: [`elevenlabs-file:${m[1]}`], costUsd: null, progress: 100 };
  },

  resultFile(ref) {
    const m = OUT_RE.exec(String(ref || ''));
    if (!m || !dir) return null;
    return { path: nodePath.join(dir, m[1]), ext: 'mp3', mime: 'audio/mpeg' };
  },
  releaseResult(ref) {
    const file = this.resultFile(ref);
    if (file) fs.promises.unlink(file.path).catch(() => {});
  },
  sweepFiles(maxAgeMs = 24 * 3600_000) {
    if (!dir) return;
    const cutoff = Date.now() - maxAgeMs;
    for (const sub of ['', 'in']) {
      let names = [];
      try { names = fs.readdirSync(nodePath.join(dir, sub)); } catch { continue; }
      for (const name of names) {
        const file = nodePath.join(dir, sub, name);
        try { const st = fs.statSync(file); if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(file); } catch { /* gone already */ }
      }
    }
  },

  // A recording for the voice changer: copied here, sent as a file at submit.
  async upload(cfg, { path: file, mime }) {
    if (!/^(audio|video)\//.test(mime)) throw Object.assign(new Error('The voice changer takes a recording (audio or video).'), { status: 400 });
    const ext = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime] || 'mp3';
    const name = `${crypto.randomBytes(12).toString('base64url')}.${ext}`;
    await fs.promises.mkdir(nodePath.join(dir, 'in'), { recursive: true });
    await fs.promises.copyFile(file, nodePath.join(dir, 'in', name));
    return { url: `elevenlabs-in:${name}`, expiresAt: Date.now() + 86_400_000 };
  },

  // Speech to text (Scribe): a file of ours → { text, language, words }.
  async transcribe({ apiKey, proxy }, { path: file, mime, name, model = 'scribe_v2', diarize = false, language = '' }) {
    const form = await fileForm('file', file, mime, name || nodePath.basename(file));
    form.append('model_id', model);
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'false');
    if (diarize) form.append('diarize', 'true');
    if (language) form.append('language_code', language);
    const response = await providerFetch(`${API}/v1/speech-to-text`, { proxy, method: 'POST', headers: auth(apiKey), body: form, timeoutMs: 30 * 60_000 });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const d = data?.detail;
      throw new ProviderHttpError(`ElevenLabs transcription: HTTP ${response.status}: ${(typeof d === 'string' ? d : d?.message) || data?.message || ''}`, { status: response.status });
    }
    return {
      text: String(data.text || ''),
      language: data.language_code || null,
      words: Array.isArray(data.words) ? data.words.filter((w) => w.type !== 'spacing').map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker_id || null })) : [],
    };
  },
};

// Words → SubRip subtitles: lines of up to ~42 characters or 3 s, broken at pauses.
export function toSrt(words) {
  const cues = [];
  let cur = null;
  for (const w of words || []) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    const gap = cur ? w.start - cur.end : 0;
    if (!cur || gap > 0.6 || (cur.text + w.text).length > 42 || w.end - cur.start > 3.2 || (w.speaker && w.speaker !== cur.speaker)) {
      if (cur) cues.push(cur);
      cur = { start: w.start, end: w.end, text: String(w.text).trim(), speaker: w.speaker };
    } else {
      cur.end = w.end;
      cur.text = `${cur.text} ${String(w.text).trim()}`.replace(/\s+([,.!?;:])/g, '$1');
    }
  }
  if (cur) cues.push(cur);
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
