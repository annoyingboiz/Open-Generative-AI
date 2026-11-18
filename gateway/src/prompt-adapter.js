// "Adapt to model": a text model rewrites the user's prompt by the prompting
// notes of the chosen image/video model (src/prompt-memos/*.md — short notes
// from the official guides, editable in the repo). The user sees the result,
// edits it and only then generates; nothing is rewritten without the button.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt-memos');
// Our tags: @image1, @first, @char_anna, @лиса… (letters, digits, _ and -).
const TAG_RE = /@([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;
const MAX_PROMPT = 12_000;

export class AdaptError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Frontmatter: simple "key: value" lines and "key:" + "  - item" lists.
function parseMemo(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return null;
  const meta = {};
  let listKey = null;
  for (const line of m[1].split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { meta[listKey].push(item[1].trim()); continue; }
    const kv = /^([a-z_]+):\s*(.*)$/i.exec(line);
    if (!kv) continue;
    const [, k, raw] = kv;
    if (raw === '') { meta[k] = []; listKey = k; continue; }
    listKey = null;
    let v = raw.trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else v = v.replace(/^"(.*)"$/, '$1');
    meta[k] = v;
  }
  if (!meta.id || !['image', 'video'].includes(meta.kind)) return null;
  let match = null;
  try { match = meta.match ? new RegExp(meta.match, 'i') : null; } catch { match = null; }
  return { id: meta.id, name: meta.name || meta.id, kind: meta.kind, match, generic: file.startsWith('_'), sources: Array.isArray(meta.sources) ? meta.sources : meta.sources ? [meta.sources] : [], body: m[2].trim() };
}

export function loadMemos(dir = DIR) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const memo = parseMemo(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    if (memo) out.push(memo);
  }
  return out;
}

export function createPromptAdapter({ llm, log, dir = DIR }) {
  let memos = loadMemos(dir);
  let loadedAt = Date.now();
  // Edited notes are picked up without a restart (checked at most once a minute).
  const fresh = () => { if (Date.now() - loadedAt > 60_000) { try { memos = loadMemos(dir); } catch (error) { log?.warn?.(`prompt memos: ${error.message}`); } loadedAt = Date.now(); } return memos; };

  function memoFor(family, kind) {
    const k = kind === 'image' ? 'image' : 'video';
    const list = fresh();
    return list.find((m) => !m.generic && m.kind === k && m.match?.test(String(family || '')))
      || list.find((m) => m.generic && m.kind === k);
  }

  const settingsLine = (ctx = {}) => {
    const parts = [];
    if (ctx.mode) parts.push(`mode: ${ctx.mode}`);
    if (ctx.duration) parts.push(`duration: ${ctx.duration} s`);
    if (ctx.aspect) parts.push(`aspect ratio: ${ctx.aspect}`);
    if (ctx.audio === true) parts.push('the model generates sound');
    if (ctx.audio === false) parts.push('sound is off — write no audio');
    if (ctx.camera) parts.push(`camera added separately by the app (don't contradict it): ${ctx.camera}`);
    return parts.length ? parts.join('; ') : 'not given';
  };

  function systemPrompt({ memo, model, ctx, tags, json }) {
    const tagLines = (ctx.tags || []).slice(0, 40).map((t) => `@${t.tag} — ${String(t.label || t.role || '').slice(0, 80)}`).join('\n');
    return [
      `You are a prompt editor for the ${model.name || memo.name} ${model.kind} model. Rewrite the user's prompt so it follows the model's prompting notes below while keeping the user's intent.`,
      '',
      'Rules:',
      '1. Keep everything the user asked for: subject, story, action, style, mood and every specific detail. Do not invent new characters, objects, brands, places or plot. Add only concrete craft details the notes call for (shot size, camera move, light, pacing, sound) where they fit and do not contradict the user.',
      '2. Write in English. Keep dialogue lines and on-screen text in the language the user wrote them, in the syntax the notes give.',
      `3. Keep every @tag exactly as written${tags.length ? ` (${tags.map((t) => `@${t}`).join(', ')})` : ''}: never rename, translate, merge or drop one. Put them where the notes say references go and say what each one is for.`,
      json ? '4. The prompt is JSON: answer with JSON of the same shape (same top-level keys). Improve the values; do not drop keys.' : '4. Plain text in, plain text out (no markdown, no headings unless the notes use labeled sections).',
      '5. Settings like duration, resolution and aspect ratio are set by the app: do not write them into the prompt unless the notes say so.',
      '6. Follow the length guidance in the notes.',
      '',
      `Generation settings: ${settingsLine(ctx)}`,
      tagLines ? `Attached references (tags):\n${tagLines}` : 'No references are attached.',
      '',
      'Answer ONLY with a JSON object: {"prompt": "<the rewritten prompt>", "changes": ["short note", "..."]} — 1 to 4 very short notes in English about what you changed.',
      '',
      `--- Prompting notes: ${memo.name} ---`,
      memo.body,
    ].join('\n');
  }

  // The model's answer: JSON with prompt/changes, sometimes wrapped in a code fence or text.
  function parseAnswer(text) {
    const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    let obj = tryParse(t);
    if (!obj) { const i = t.indexOf('{'); const j = t.lastIndexOf('}'); if (i >= 0 && j > i) obj = tryParse(t.slice(i, j + 1)); }
    if (obj && (typeof obj.prompt === 'string' || (obj.prompt && typeof obj.prompt === 'object'))) {
      return { prompt: typeof obj.prompt === 'string' ? obj.prompt : JSON.stringify(obj.prompt, null, 2), changes: Array.isArray(obj.changes) ? obj.changes.map(String).slice(0, 4) : [] };
    }
    return t ? { prompt: t, changes: [] } : null;
  }

  const tagsIn = (s) => [...new Set([...String(s).matchAll(TAG_RE)].map((m) => m[1].toLowerCase()))];

  async function adapt(user, body = {}) {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new AdaptError('Write a prompt first.');
    if (prompt.length > MAX_PROMPT) throw new AdaptError(`The prompt is too long (max ${MAX_PROMPT} characters).`);
    const model = { family: String(body.model?.family || ''), name: String(body.model?.name || '').slice(0, 120), kind: body.model?.kind === 'image' ? 'image' : 'video' };
    const memo = memoFor(model.family, model.kind);
    if (!memo) throw new AdaptError('No prompting notes for this kind of model.', 500);
    const ctx = body.context && typeof body.context === 'object' ? body.context : {};
    const tags = tagsIn(prompt);
    let json = false;
    if (/^[[{]/.test(prompt)) { try { JSON.parse(prompt); json = true; } catch { json = false; } }
    const system = systemPrompt({ memo, model, ctx, tags, json });
    const ask = (extra = '') => llm.chat(user, { model: body.llm || undefined, system, prompt: `${prompt}${extra}`, purpose: 'adapt-prompt', maxTokens: 2500, temperature: 0.3 });
    let r = await ask();
    let out = parseAnswer(r.text);
    // A dropped @tag would lose a reference: one more try, telling the model which.
    let lost = out ? tags.filter((t) => !tagsIn(out.prompt).includes(t)) : tags;
    let cost = r.costUsd ?? 0;
    let ms = r.ms;
    if (out && lost.length) {
      const r2 = await ask(`\n\n(Your previous answer dropped these tags; keep them all: ${lost.map((t) => `@${t}`).join(', ')})`);
      const out2 = parseAnswer(r2.text);
      cost += r2.costUsd ?? 0;
      ms += r2.ms;
      const lost2 = out2 ? tags.filter((t) => !tagsIn(out2.prompt).includes(t)) : tags;
      if (out2 && lost2.length < lost.length) { out = out2; lost = lost2; r = r2; }
    }
    if (!out?.prompt) throw new AdaptError('The text model returned nothing usable. Try again or pick another text model.', 424);
    if (json) { try { JSON.parse(out.prompt); } catch { throw new AdaptError('The text model broke the JSON. Try again or pick another text model.', 424); } }
    return {
      prompt: out.prompt.trim(),
      changes: out.changes,
      lostTags: lost.map((t) => `@${t}`),
      memo: { id: memo.id, name: memo.name, generic: memo.generic },
      llm: r.model, costUsd: r.costUsd == null ? null : Math.round(cost * 1e6) / 1e6, ms,
    };
  }

  // For "Model notes" in the studio.
  function notes(family, kind) {
    const memo = memoFor(family, kind);
    return memo ? { id: memo.id, name: memo.name, generic: memo.generic, sources: memo.sources, body: memo.body } : null;
  }

  return { adapt, notes, memoFor, list: () => fresh().map(({ id, name, kind, generic }) => ({ id, name, kind, generic })) };
}
