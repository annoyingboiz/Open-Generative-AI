import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLook, renderLook, lookHints, lookAdvice, lookForClient } from '../src/look.js';
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
  assert.match(veo, /^Shot on 35mm motion-picture colour negative film.*not digitally sharp\. Anamorphic lens.*slow dolly-in toward the subject\. A woman/);
  assert.match(veo, /A woman walks through a market\. Lighting: warm low golden-hour/);
  const seed = renderLook('Subject: a woman\nCamera: medium shot', look, { kind: 'video', memo: memos.seedance });
  // Seedance (handoff 17, §7): the camera in [Overall style] with the fill-frame line; lens and move in Camera.
  assert.match(seed, /^\[Overall style\] Shot on 35mm motion-picture.*fills the whole frame edge to edge, no black bars, no border, square corners\./);
  assert.match(seed, /^Camera: medium shot; anamorphic lens.*slow dolly-in/m);
  assert.match(seed, /^Style: warm low golden-hour.*1970s period/m);
  const kling = renderLook('A woman walks.', look, { kind: 'video', memo: memos.kling });
  assert.match(kling, /^A woman walks\.\n/);
  assert.match(kling, /^Camera: anamorphic lens/m);
  assert.match(kling, /^Visual style: Shot on 35mm motion-picture colour negative film with a spherical cinema lens\.$/m);
  assert.match(kling, /^Camera tone: Soft highlight roll-off/m);
  const img = renderLook('A portrait', look, { kind: 'image', memo: memos['nano-banana'] });
  assert.match(img, /^A portrait\. Shot on 35mm motion-picture/);
  assert.doesNotMatch(img, /dolly/, 'no camera move for pictures');
  const json = JSON.parse(renderLook('{"subject":"woman","Lighting":"mine"}', look, { kind: 'image' }));
  assert.match(json.Lighting, /^mine; warm low golden-hour/, 'added to the user key, any letter case');
  assert.match(json.camera, /35mm motion-picture/);
  const sj = JSON.parse(renderLook('{"subject":"woman","camera":"medium shot"}', look, { kind: 'video', memo: memos.seedance }));
  assert.match(sj.camera, /^medium shot; \[Overall style\]|^medium shot; Shot on 35mm motion-picture.*dolly-in/);
  assert.match(sj.style, /golden-hour.*1970s/);
  const vj = JSON.parse(renderLook('{"subject":"woman"}', look, { kind: 'video', memo: memos.veo }));
  assert.ok(vj.cinematography && vj.style, 'Veo JSON keys');
  const vo = JSON.parse(renderLook('{"Cinematography":{"shot":"wide"}}', look, { kind: 'video', memo: memos.veo }));
  assert.equal(vo.Cinematography.shot, 'wide');
  assert.match(vo.Cinematography.look, /35mm motion-picture/, 'an object block gets the look as its own field');
  // An adapted Veo prompt in blocks: the look joins the blocks instead of a first sentence.
  const vb = renderLook('Cinematography: wide shot.\nSubject: a woman.\nStyle: muted.', look, { kind: 'video', memo: memos.veo });
  assert.match(vb, /^Cinematography: wide shot; Shot on 35mm motion-picture/m);
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

test('look: advice names its block (package 04)', () => {
  const odd = cleanLook({ on: true, camera: 'phone', lens: 'fisheye', focal: 85, aperture: 'f/1.4' });
  const advice = lookAdvice(odd, { aspect: '16:9' });
  assert.ok(advice.length >= 2 && advice.every((a) => a.block === 'camera'));
  const zoom = lookAdvice(cleanLook({ on: true, lens: 'clean', move: 'zoom-in' }), { kind: 'video', aspect: '16:9' });
  assert.ok(zoom.some((a) => a.block === 'move' && /can’t zoom/.test(a.text)));
});

test('look: the browser gets labels, not prompt words', () => {
  const c = lookForClient();
  // Seven cameras (handoff 17, §3); the old ones are not offered.
  assert.deepEqual(c.cameras.map((x) => x.id), ['modern', 'film-35', 'film-16', 'super-8', 'dv', 'vhs', 'phone']);
  assert.ok(c.lenses.length >= 9 && c.eras.length && c.lights.length && c.moves.length);
  assert.ok(!JSON.stringify(c).includes('motion-picture'));
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

test('camera pipeline (handoff 17): start frame, old cameras, per-model words, no texture words', async () => {
  const memos = Object.fromEntries(loadMemos().map((m) => [m.id, m]));
  const { CAMERAS, textureOf, KEEP_FRAME, reshootPrompt } = await import('../src/look.js');
  const full = cleanLook({ on: true, camera: 'phone', lens: 'anamorphic', focal: 24, aperture: 'f/2', filter: 'diffusion', move: 'push-in', light: 'golden-hour' });
  // §4 rule 1: from a start frame no camera, lens or aperture words; the keep line; the move stays.
  for (const id of ['kling', 'seedance', 'wan', 'veo', 'minimax']) {
    const p = renderLook('A woman walks.', full, { kind: 'video', memo: memos[id], framed: true, ratio: '16:9' });
    assert.ok(p.includes(KEEP_FRAME), id);
    assert.doesNotMatch(p, /smartphone|phone lens|anamorphic|24mm|f\/2|depth of field|Pro-Mist|Overall style|Visual style/i, id);
    assert.match(p, id === 'kling' ? /very slight slow move closer/ : /push-in/, id);
    // Doc 42, answer 1: Phone keeps its handheld behaviour line (motion, not look), before the keep line.
    assert.match(p, /\nHandheld phone video - small natural hand shake.*No phone or other device is visible in the picture\.\n/, id);
    assert.doesNotMatch(p, /continuous shot|Not cinematic|computational HDR/, id);
  }
  // Another camera from a start frame: no behaviour line.
  assert.doesNotMatch(renderLook('A woman walks.', cleanLook({ on: true, camera: 'vhs' }), { kind: 'video', memo: memos.kling, framed: true }), /Handheld/);
  // An image from a start frame (not a video): no behaviour line either.
  assert.doesNotMatch(renderLook('A woman walks.', cleanLook({ on: true, camera: 'phone' }), { kind: 'image', framed: true }), /Handheld/);
  // A JSON prompt from a start frame: the line goes with the camera movement.
  assert.match(JSON.parse(renderLook('{"scene":"a woman walks"}', cleanLook({ on: true, camera: 'phone' }), { kind: 'video', framed: true })).camera_movement, /^Handheld phone video/);
  // Old cameras stay as stored and add nothing (shown as Modern).
  const old = cleanLook({ on: true, camera: 'digital' });
  assert.equal(old.camera, 'digital');
  assert.equal(renderLook('A woman walks.', old, { kind: 'video' }), 'A woman walks.');
  assert.equal(textureOf(old), null);
  assert.equal(textureOf(cleanLook({ on: true, camera: 'vhs' })), 'vhs');
  assert.equal(textureOf(cleanLook({ on: true, camera: 'phone' })), null);
  // Kling: VHS and 8mm get colour and tone only, never the medium (it draws a 4:3 picture).
  for (const camera of ['vhs', 'super-8']) {
    const k = renderLook('A woman walks.', cleanLook({ on: true, camera }), { kind: 'video', memo: memos.kling });
    assert.match(k, /^Camera tone: /m);
    assert.doesNotMatch(k, /VHS|Super 8|home recording|home movie|sprocket/i);
  }
  const kp = renderLook('A woman walks.', cleanLook({ on: true, camera: 'phone' }), { kind: 'video', memo: memos.kling, ratio: '16:9' });
  assert.match(kp, /^Visual style: Casual horizontal video filmed by a friend/m);
  assert.doesNotMatch(kp, /stretching at the frame edges/);
  // §7 (23.11): handheld behaviour and no device in the picture; Kling also one continuous shot.
  assert.match(kp, /Handheld phone video - small natural hand shake.*No phone or other device is visible in the picture\. One continuous shot, no cuts\.$/m);
  const kv = renderLook('A woman walks.', cleanLook({ on: true, camera: 'phone' }), { kind: 'video', memo: memos.kling, ratio: '9:16' });
  assert.match(kv, /^Visual style: Casual video filmed by a friend/m, 'no orientation word away from 16:9');
  assert.doesNotMatch(kv, /vertical/);
  const sp = renderLook('A woman walks.', cleanLook({ on: true, camera: 'phone' }), { kind: 'video', memo: memos.seedance, ratio: '16:9' });
  assert.match(sp, /No phone or other device is visible in the picture/);
  assert.doesNotMatch(sp, /continuous shot/, 'Kling only');
  // Wan: the camera sentence right after "Generate single shot.", look and fill-frame in Style.
  const wan = renderLook('Generate single shot. A woman walks.', cleanLook({ on: true, camera: 'dv' }), { kind: 'video', memo: memos.wan, ratio: '16:9' });
  assert.match(wan, /^Generate single shot\. Amateur home video from the year 2000.*\. A woman walks\./);
  assert.match(wan, /^Style: Standard-definition video.*No text, no date stamp\. The picture fills the whole 16:9 frame edge to edge, no black bars, no border\.$/m);
  const wan2 = renderLook('A woman walks.', cleanLook({ on: true, camera: 'vhs' }), { kind: 'video', memo: memos.wan, ratio: '16:9' });
  assert.match(wan2, /^Generate single shot\. A 1990s VHS home recording\. A woman walks\./);
  const wanMulti = renderLook('Shot 1 [0-3s] a woman walks. Shot 2 [3-6s] she sits.', cleanLook({ on: true, camera: 'vhs' }), { kind: 'video', memo: memos.wan });
  assert.doesNotMatch(wanMulti, /Generate single shot/);
  // A start frame with only a move or a light: the keep line too.
  assert.ok(renderLook('A woman walks.', cleanLook({ move: 'orbit' }), { kind: 'video', memo: memos.kling, framed: true }).includes(KEEP_FRAME));
  // No drawn texture anywhere: grain, dust, scratches, light leaks, tracking bands, timestamps belong to the filter.
  const BAD = /dust|scratch|hair|light leak|tracking|grain(?!s? *$)|timestamp(?! *$)/i;
  for (const c of CAMERAS.filter((x) => x.shot)) {
    assert.doesNotMatch(`${c.shot} ${c.look}`, /dust|scratch|light leak|tracking band/i, c.id);
    if (c.reshoot) assert.doesNotMatch(`${c.reshoot.camera} ${c.reshoot.look}`, /dust|scratch|light leak|tracking band/i, c.id);
  }
  assert.ok(BAD);
  // §5: the re-shoot prompt.
  const r = reshootPrompt(cleanLook({ on: true, camera: 'super-8' }), { ratio: '16:9' });
  assert.match(r, /^Re-shoot the scene in @img1 as a frame of a Super 8 home movie: the same people, clothes, objects and place, same faces, same moment and pose\. Soft blurry detail.*No rounded corners, no sprocket holes\. The picture fills the whole 16:9 frame, no black bars, no border\.$/);
  assert.doesNotMatch(r, /dust|scratch|light leak/i, 'check 6');
  const ra = reshootPrompt(cleanLook({ on: true, camera: 'film-35', lens: 'anamorphic', aperture: 'f/16' }), { ratio: '9:16', ref: '@image1' });
  assert.match(ra, /^Re-shoot the scene in @image1 on 35mm motion-picture colour negative film with a spherical cinema lens through an anamorphic lens:/);
  assert.match(ra, /Long thin horizontal blue lens flares.*Everything is sharp from the nearest object/);
  // Phone (§5.1): canvas extension, the generic prompt, lens and aperture ignored.
  const rp = reshootPrompt(cleanLook({ on: true, camera: 'phone', lens: 'anamorphic', aperture: 'f/1.4' }), { ratio: '16:9' });
  assert.match(rp, /^@img1 is a photo placed in the middle of a larger plain grey canvas\..*The picture fills the whole 16:9 frame\.$/);
  assert.doesNotMatch(rp, /anamorphic|depth of field|flare/i);
});
