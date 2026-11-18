import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLook, renderLook, lookHints, lookForClient } from '../src/look.js';
import { loadMemos } from '../src/prompt-adapter.js';

const look = cleanLook({ on: true, camera: 'film-35', lens: 'anamorphic', focal: 50, aperture: 'f/2.8', era: '1970s', light: 'golden-hour', move: 'dolly-in' });

test('look: only known ids; names used before 18.11 are mapped', () => {
  assert.equal(cleanLook({ camera: 'nope', lens: '<script>' }), null);
  const old = cleanLook({ on: true, camera: 'Classic 16mm Film', lens: 'Halation Diffusion', focal: 8, aperture: 'f/11' });
  assert.deepEqual([old.camera, old.lens, old.focal, old.aperture, old.filter], ['film-16', 'clean', 12, 'f/11', 'diffusion']);
  assert.equal(cleanLook({ on: false, era: '1980s' }).on, false);
});

test('look: each model gets it in its place', () => {
  const memos = Object.fromEntries(loadMemos().map((m) => [m.id, m]));
  const veo = renderLook('A woman walks through a market', look, { kind: 'video', memo: memos.veo });
  assert.match(veo, /^Shot on 35mm film/);
  assert.match(veo, /A woman walks through a market\. Lighting: warm low golden-hour/);
  const seed = renderLook('Subject: a woman\nCamera: medium shot', look, { kind: 'video', memo: memos.seedance });
  assert.match(seed, /^Camera: medium shot; shot on 35mm film.*slow dolly-in/m);
  assert.match(seed, /^Style: warm low golden-hour.*1970s period/m);
  const kling = renderLook('A woman walks.', look, { kind: 'video', memo: memos.kling });
  assert.match(kling, /^A woman walks\.\nCamera: shot on 35mm film/);
  const img = renderLook('A portrait', look, { kind: 'image', memo: memos['nano-banana'] });
  assert.match(img, /^A portrait\. Shot on 35mm film/);
  assert.doesNotMatch(img, /dolly/, 'no camera move for pictures');
  const json = JSON.parse(renderLook('{"subject":"woman","Lighting":"mine"}', look, { kind: 'image' }));
  assert.match(json.Lighting, /^mine; warm low golden-hour/, 'added to the user key, any letter case');
  assert.match(json.camera, /35mm film/);
  const sj = JSON.parse(renderLook('{"subject":"woman","camera":"medium shot"}', look, { kind: 'video', memo: memos.seedance }));
  assert.match(sj.camera, /^medium shot; shot on 35mm film.*dolly-in/);
  assert.match(sj.style, /golden-hour.*1970s/);
  const vj = JSON.parse(renderLook('{"subject":"woman"}', look, { kind: 'video', memo: memos.veo }));
  assert.ok(vj.cinematography && vj.style, 'Veo JSON keys');
  const vo = JSON.parse(renderLook('{"Cinematography":{"shot":"wide"}}', look, { kind: 'video', memo: memos.veo }));
  assert.equal(vo.Cinematography.shot, 'wide');
  assert.match(vo.Cinematography.look, /35mm film/, 'an object block gets the look as its own field');
  // An adapted Veo prompt in blocks: the look joins the blocks instead of a first sentence.
  const vb = renderLook('Cinematography: wide shot.\nSubject: a woman.\nStyle: muted.', look, { kind: 'video', memo: memos.veo });
  assert.match(vb, /^Cinematography: wide shot; shot on 35mm film/m);
  assert.match(vb, /^Style: muted; warm low golden-hour/m);
  assert.equal(renderLook('[1,2]', look, { kind: 'image' }), '[1,2]');
});

test('look: unusual combinations give hints, not errors', () => {
  const odd = cleanLook({ on: true, camera: 'phone', lens: 'fisheye', focal: 85, aperture: 'f/1.4' });
  const hints = lookHints(odd, { aspect: '16:9' });
  assert.ok(hints.some((h) => /Fisheye lenses are usually 8–16 mm/.test(h)));
  assert.ok(hints.some((h) => /Phone rarely gives strong background blur/.test(h)));
  assert.ok(hints.every((h) => /Experiment!$/.test(h)));
  assert.deepEqual(lookHints(look, { aspect: '16:9' }), []);
  assert.ok(lookHints(look, { aspect: '9:16' }).some((h) => /widescreen/.test(h)));
});

test('look: the browser gets labels, not prompt words', () => {
  const c = lookForClient();
  assert.ok(c.cameras.length >= 9 && c.lenses.length >= 9 && c.eras.length && c.lights.length && c.moves.length);
  assert.ok(!JSON.stringify(c).includes('Kodak'));
});

test('look: planner answers and old shots keep their look', async () => {
  const { cleanShot } = await import('../src/director.js');
  const s = cleanShot({ camera: 'film-35 (Classic film grain and color)', lens: 'Halation Diffusion', focal: '14mm', aperture: 'f/4' }, { id: 's1' });
  assert.deepEqual([s.camera, s.lens, s.filter, s.focal, s.aperture], ['film-35', 'clean', 'diffusion', 16, 'f/4']);
});

test('palette and genre (Studio Look panel) are cleaned and written into the prompt', () => {
  const look = cleanLook({ palette: 'noir', genre: 'thriller', palette_bad: 'x' });
  assert.equal(look.palette, 'noir');
  assert.equal(look.genre, 'thriller');
  assert.equal(cleanLook({ palette: 'nope' }), null);
  const out = renderLook('A man waits at a bus stop.', look, { kind: 'video' });
  assert.match(out, /black-and-white noir grade/);
  assert.match(out, /thriller tone/);
  const json = JSON.parse(renderLook('{"scene":"a man waits"}', look, { kind: 'video' }));
  assert.match(json.color, /noir/);
  assert.match(json.genre, /thriller/);
});
