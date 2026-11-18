import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPromptAdapter, loadMemos } from '../src/prompt-adapter.js';

function fakeLlm(answers) {
  const calls = [];
  return {
    calls,
    async chat(user, body) {
      calls.push(body);
      const a = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { text: typeof a === 'function' ? a(body) : a, model: body.model || 'local:test', costUsd: 0.001, ms: 10 };
    },
  };
}

test('every memo parses, has a body and sources; one generic per kind', () => {
  const memos = loadMemos();
  assert.ok(memos.length >= 15);
  for (const m of memos) {
    assert.ok(m.body.length > 200, m.id);
    assert.ok(m.generic || m.match, `${m.id} has a match`);
    assert.ok(m.sources.length, `${m.id} lists sources`);
  }
  assert.equal(memos.filter((m) => m.generic && m.kind === 'video').length, 1);
  assert.equal(memos.filter((m) => m.generic && m.kind === 'image').length, 1);
});

test('picks the family notes, builds the instruction with tags and settings, returns the rewrite', async () => {
  const llm = fakeLlm([JSON.stringify({ prompt: '@image1 is the jacket; keep its stitching. Slow orbit around a model. 0–5s: she turns. No subtitles.', changes: ['Gave @image1 a role', 'Added timed beat'] })]);
  const a = createPromptAdapter({ llm });
  const r = await a.adapt({ id: 1 }, {
    prompt: 'девушка в куртке @image1 поворачивается',
    model: { family: 'kling-4', name: 'Kling 4 · Atlas', kind: 'video' },
    context: { mode: 'reference-to-video', duration: 5, aspect: '9:16', audio: true, tags: [{ tag: 'image1', label: 'Reference' }] },
    llm: 'local:qwen3.6:27b',
  });
  assert.equal(r.memo.id, 'kling');
  assert.match(r.prompt, /@image1/);
  assert.deepEqual(r.lostTags, []);
  assert.equal(r.changes.length, 2);
  const sent = llm.calls[0];
  assert.equal(sent.model, 'local:qwen3.6:27b');
  assert.equal(sent.purpose, 'adapt-prompt');
  assert.match(sent.system, /Kling — prompt notes/);
  assert.match(sent.system, /@image1 — Reference/);
  assert.match(sent.system, /duration: 5 s/);
  assert.match(sent.system, /Keep every @tag exactly/);
});

test('a dropped @tag is asked for again; JSON stays JSON; junk is refused', async () => {
  let llm = fakeLlm(['{"prompt":"A woman turns.","changes":[]}', '{"prompt":"@first A woman turns, @char_anna smiles.","changes":[]}']);
  let a = createPromptAdapter({ llm });
  let r = await a.adapt({ id: 1 }, { prompt: '@first woman turns, @char_anna smiles', model: { family: 'veo-3.1', kind: 'video' } });
  assert.equal(llm.calls.length, 2, 'asked once more');
  assert.match(llm.calls[1].prompt, /@first, @char_anna/);
  assert.deepEqual(r.lostTags, []);

  llm = fakeLlm(['```json\n{"prompt": {"scene": "night market", "camera": "slow push-in"}, "changes": ["camera"]}\n```']);
  a = createPromptAdapter({ llm });
  r = await a.adapt({ id: 1 }, { prompt: '{"scene":"night market"}', model: { family: 'nano-banana-2', kind: 'image' } });
  assert.deepEqual(JSON.parse(r.prompt), { scene: 'night market', camera: 'slow push-in' });
  assert.match(llm.calls[0].system, /same shape/);
  assert.equal(r.memo.id, 'nano-banana');

  llm = fakeLlm(['{"prompt":"{broken","changes":[]}']);
  a = createPromptAdapter({ llm });
  await assert.rejects(a.adapt({ id: 1 }, { prompt: '{"a":1}', model: { family: 'flux-3', kind: 'image' } }), /broke the JSON/);
  await assert.rejects(a.adapt({ id: 1 }, { prompt: '   ', model: { kind: 'image' } }), /Write a prompt/);
  // Unknown family: the general notes for its kind.
  llm = fakeLlm(['plain text answer without json']);
  a = createPromptAdapter({ llm });
  r = await a.adapt({ id: 1 }, { prompt: 'a fox', model: { family: 'happyhorse-1', kind: 'video' } });
  assert.equal(r.memo.generic, true);
  assert.equal(r.prompt, 'plain text answer without json');
  assert.equal(a.notes('seedream-5-pro', 'image').id, 'seedream');
});
