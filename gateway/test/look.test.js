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
  // Block mode (docs/ux/43 §3, 44 §C): the user's text stays, the look below in labelled blocks.
  const seed = renderLook('Subject: a woman\nCamera: medium shot', look, { kind: 'video', memo: memos.seedance, ratio: '16:9' });
  assert.match(seed, /^Subject: a woman\nCamera: medium shot\. Slow dolly-in toward the subject\.$/m, 'the user\'s Camera: block gets the move');
  assert.match(seed, /^FOCUS Subject critically sharp\./m);
  assert.match(seed, /^STYLE Soft highlight roll-off.*Oval out-of-focus highlights, horizontal blue streak flares\. Warm low golden-hour.*1970s period/m);
  assert.match(seed, /^TECH Shot on 35mm motion-picture colour negative film\. The picture fills the whole 16:9 frame edge to edge, no black bars, no border, square corners\.$/m);
  assert.doesNotMatch(seed, /FRAMING/, 'Seedance: no FRAMING until its ladder is measured');
  const kling = renderLook('A woman walks.', look, { kind: 'video', memo: memos.kling });
  // FRAMING is held on every model until the place anchor is settled (docs/ux/45 §5C).
  assert.match(kling, /^A woman walks\.\n\nFOCUS /);
  assert.doesNotMatch(kling, /FRAMING/);
  assert.ok(kling.indexOf('FOCUS') < kling.indexOf('CAMERA') && kling.indexOf('CAMERA') < kling.indexOf('STYLE') && kling.indexOf('STYLE') < kling.indexOf('TECH'));
  for (const p of [seed, kling]) {
    const ours = p.replace(/^(Subject|Camera|A woman)[^\n]*\n?/gm, '');
    assert.doesNotMatch(ours, /\blens\b|\b\d+\s?mm\b(?! motion-picture)/i, 'no "lens", no mm value (film gauge excepted)');
  }
  const img = renderLook('A portrait', look, { kind: 'image', memo: memos['nano-banana'] });
  assert.match(img, /^A portrait\. Shot on 35mm motion-picture/);
  assert.doesNotMatch(img, /dolly/, 'no camera move for pictures');
  const json = JSON.parse(renderLook('{"subject":"woman","Lighting":"mine"}', look, { kind: 'image' }));
  assert.match(json.Lighting, /^mine; warm low golden-hour/, 'added to the user key, any letter case');
  assert.match(json.camera, /35mm motion-picture/);
  const sj = JSON.parse(renderLook('{"subject":"woman","camera":"medium shot"}', look, { kind: 'video', memo: memos.seedance }));
  // Block mode with a JSON prompt: the blocks as keys, added to the user's own; no "lens", no mm.
  assert.match(sj.camera, /^medium shot; Slow dolly-in toward the subject\.$/);
  assert.match(sj.style, /Oval out-of-focus highlights.*Warm low golden-hour.*1970s period/);
  assert.match(sj.tech, /^Shot on 35mm motion-picture colour negative film\./);
  assert.doesNotMatch(JSON.stringify(sj), /\blens\b|50\s?mm/i);
  const kj = JSON.parse(renderLook('{"scene":"woman"}', look, { kind: 'video', memo: memos.kling, framed: true }));
  assert.match(kj.tech, /^Keep the focus, colour and image texture of the first frame/);
  assert.doesNotMatch(JSON.stringify(kj), /\blens\b|framing|golden/i);
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
  const { CAMERAS, textureOf, KEEP_FRAME, KEEP_FRAME_BLOCKS, reshootPrompt } = await import('../src/look.js');
  const full = cleanLook({ on: true, camera: 'phone', lens: 'anamorphic', focal: 24, aperture: 'f/2', filter: 'diffusion', move: 'push-in', light: 'golden-hour' });
  // §4 rule 1: from a start frame no camera, lens or aperture words; the keep line; the move stays.
  for (const id of ['kling', 'seedance', 'wan', 'veo', 'minimax']) {
    const p = renderLook('A woman walks.', full, { kind: 'video', memo: memos[id], framed: true, ratio: '16:9' });
    const blocks = id === 'kling' || id === 'seedance';
    assert.ok(p.includes(blocks ? KEEP_FRAME_BLOCKS : KEEP_FRAME), id);
    assert.doesNotMatch(p, /smartphone|phone lens|anamorphic|24mm|f\/2|depth of field|Pro-Mist|Overall style|Visual style/i, id);
    assert.match(p, id === 'kling' ? /very slight slow move closer/i : /push-in/i, id);
    // Doc 42, answer 1: Phone keeps its handheld behaviour line (motion, not look).
    assert.match(p, blocks ? /^CAMERA Handheld\. The video is filmed on a phone held in one hand\..*horizon tilts a little to the left and to the right\. No phone or other device is visible in the picture\.(?: (?:Very slight slow move closer|Fast push-in)[^\n]*)?\n\nA woman walks\./is
      : /\nHandheld phone video - small natural hand shake.*No phone or other device is visible in the picture\.\n/, id);
    assert.doesNotMatch(p, /continuous shot|Not cinematic|computational HDR/, id);
    // Block mode from a start frame (doc 43 §3.5): only CAMERA and the keep line; no FRAMING, FOCUS, STYLE, light.
    if (blocks) assert.doesNotMatch(p, /FRAMING|FOCUS|STYLE|golden-hour|\blens\b/, id);
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
    assert.match(k, /^STYLE /m);
    assert.doesNotMatch(k, /^TECH /m);
    assert.doesNotMatch(k, /VHS|Super 8|home recording|home movie|sprocket/i);
  }
  const kp = renderLook('A woman walks.', cleanLook({ on: true, camera: 'phone' }), { kind: 'video', memo: memos.kling, ratio: '16:9' });
  assert.match(kp, /^TECH Casual horizontal video filmed by a friend.*Wide-angle phone camera held close/m);
  assert.doesNotMatch(kp, /\blens\b/);
  assert.doesNotMatch(kp, /stretching at the frame edges/);
  // §7 (23.11): handheld behaviour and no device in the picture; Kling also one continuous shot.
  assert.match(kp, /^CAMERA Handheld phone video - small natural hand shake.*No phone or other device is visible in the picture\.$/m);
  assert.match(kp, /^TECH .*One continuous shot, no cuts\.$/m);
  const kv = renderLook('A woman walks.', cleanLook({ on: true, camera: 'phone' }), { kind: 'video', memo: memos.kling, ratio: '9:16' });
  assert.match(kv, /^TECH Casual video filmed by a friend/m, 'no orientation word away from 16:9');
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
  assert.ok(renderLook('A woman walks.', cleanLook({ move: 'orbit' }), { kind: 'video', memo: memos.kling, framed: true }).includes(KEEP_FRAME_BLOCKS));
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

test('block mode (docs/ux/43 §3, 44 §C): FRAMING from shot size or focal, user blocks kept, no lens words', async () => {
  const memos = Object.fromEntries(loadMemos().map((m) => [m.id, m]));
  const { SHOTS, FOCAL_SHOT } = await import('../src/look.js');
  // FRAMING is held in the real memos (docs/ux/45); these check the block code with it switched on.
  const klingF = { ...memos.kling, look: { ...memos.kling.look, framing: true } };
  assert.doesNotMatch(renderLook('A woman.', cleanLook({ on: true, focal: 85 }), { kind: 'video', memo: memos.kling }), /FRAMING/);
  const k = (p, l) => renderLook(p, cleanLook(l), { kind: 'video', memo: klingF, ratio: '16:9' });
  // Focal → default shot size; a shot size set elsewhere (storyboard names too) wins; Auto focal → no FRAMING.
  assert.match(k('A woman.', { on: true, focal: 85 }), /^FRAMING Head-and-shoulders shot\./m);
  assert.match(k('A woman.', { on: true, focal: 135 }), /^FRAMING Face close-up\./m);
  assert.match(k('A woman.', { on: true, focal: 24, shot: 'close-up' }), /^FRAMING Face close-up\./m, 'storyboard close-up beats 24 mm');
  assert.match(k('A woman.', { on: true, focal: 85, shot: 'waist' }), /^FRAMING Waist-up shot\./m);
  assert.doesNotMatch(k('A woman.', { on: true, camera: 'film-35' }), /FRAMING/);
  assert.deepEqual(Object.keys(FOCAL_SHOT).map(Number), [12, 16, 24, 35, 50, 85, 135, 200]);
  for (const s of SHOTS) assert.doesNotMatch(s.framing, /\blens\b|\d+\s?mm|one step/i);
  // FOCUS: three tested steps.
  assert.match(k('A.', { on: true, aperture: 'f/1.4' }), /^FOCUS Subject critically sharp\. Background fully defocused/m);
  assert.match(k('A.', { on: true, aperture: 'f/4' }), /^FOCUS Subject sharp\. Background slightly soft/m);
  assert.match(k('A.', { on: true, aperture: 'f/11' }), /^FOCUS Deep focus\./m);
  // The user's own blocks: words join them; the user's FRAMING wins over ours.
  const mine = k('SCENE Shop.\n\nCAMERA Fully static, locked-off.\n\nFRAMING Medium shot. @Image1 woman centered.\n\nTECH One continuous shot', { on: true, focal: 135, aperture: 'f/11', move: 'orbit', camera: 'dv' });
  assert.match(mine, /^CAMERA Fully static, locked-off\. Camera orbits around the subject in a smooth arc\.$/m);
  assert.match(mine, /^FRAMING Medium shot\. @Image1 woman centered\.$/m);
  assert.doesNotMatch(mine, /Face close-up/);
  assert.match(mine, /^TECH One continuous shot\. Amateur home video from the year 2000/m);
  assert.match(mine, /\n\nFOCUS Deep focus\..*\n\nSTYLE Standard-definition video/s);
  assert.equal((mine.match(/^CAMERA/gm) || []).length, 1, 'no second CAMERA block');
  // A word that only starts like a label is not a block.
  assert.match(k('Focus on her eyes.', { on: true, aperture: 'f/11' }), /^Focus on her eyes\.\n\nFOCUS Deep focus\./);
  // Lens choice → its effect in STYLE, never the word "lens".
  const an = k('A.', { on: true, lens: 'vintage-anamorphic', focal: 50 });
  assert.match(an, /^STYLE Warm amber streak flares/m);
  assert.doesNotMatch(an, /\blens\b|50\s?mm/i);
  // Wan and others: unchanged.
  assert.doesNotMatch(renderLook('A.', cleanLook({ on: true, focal: 85 }), { kind: 'video', memo: memos.wan }), /FRAMING/);
  // The panel line "85 mm → head and shoulders".
  assert.equal(lookForClient({ framing: true }).focalShots['85'], 'head and shoulders');
  assert.deepEqual(lookForClient().focalShots, {}, 'FRAMING held: no shot-size line in the panel');
});

test('block mode: title-case labels end a block; a shot size alone is enough for FRAMING', async () => {
  const memos = Object.fromEntries(loadMemos().map((m) => [m.id, m]));
  const p = renderLook('Camera: locked.\nSound: room tone.', cleanLook({ move: 'orbit' }), { kind: 'video', memo: memos.kling });
  assert.match(p, /^Camera: locked\. Camera orbits around the subject in a smooth arc\.\nSound: room tone\.$/);
  const note = renderLook('CAMERA Static.\nNote: she smiles.\n\nSCENE Shop.', cleanLook({ move: 'orbit' }), { kind: 'video', memo: memos.kling });
  assert.match(note, /^CAMERA Static\.\nNote: she smiles\. Camera orbits around the subject in a smooth arc\.\n\nSCENE Shop\.$/);
  const klingF = { ...memos.kling, look: { ...memos.kling.look, framing: true } };
  assert.match(renderLook('A woman.', cleanLook({ shot: 'close-up' }), { kind: 'video', memo: klingF }), /^FRAMING Face close-up\./m);
  assert.equal(renderLook('A cup.', cleanLook({ shot: 'insert' }), { kind: 'video', memo: klingF }), 'A cup.');
});
