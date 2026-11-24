// Person / object / not set (docs/ux/50 §4, 51 §3): the studio decides with the same rules and the
// same word lists as the gateway (src/subject-words.js), so the Look panel, the preview and the server agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lookForClient } from '../src/look.js';
import { subjectOf } from '../src/subject-words.js';

test('studio lookSubject matches the gateway rules; the Look panel says what was decided', async () => {
  globalThis.window = { __DZ_CATALOG__: { look: lookForClient({ framing: true }) } };
  try {
    const { lookSubject, focalShotText, lookOf, lookLabel } = await import('../../packages/studio/src/dzCreate.js');
    const cases = [
      ['A woman at a bar.', []], ['Her face.', []], ["A bartender's hand pours amber cocktail into the glass.", []],
      ['A hand pours into the glass on the counter.', []], ['A quiet street at night.', []], ['A rocks glass with ice.', []],
      ['SCENE Bar.\n\nOBJECTS\nThe @Image1 rocks glass with ice.\n\nACTION A woman pours.', []],
      ['SCENE Bar.\n\nOBJECTS\nA woman in a yellow coat.\n\nBACKGROUND Bottles.', []],
      ['{"objects": ["a perfume bottle"], "scene": "a woman holds it"}', []],
      ['She pours.', ['character']], ['She pours into the glass.', ['object']], ['A woman holds the glass.', ['character', 'object']], ['A woman.', ['place']],
    ];
    for (const [p, k] of cases) assert.equal(lookSubject(p, k), subjectOf(p, k), p);
    assert.equal(lookSubject("A bartender's hand pours amber cocktail into the glass."), 'none');
    assert.equal(focalShotText(85, 'person'), '85mm → head and shoulders (person)');
    assert.equal(focalShotText(85, 'object'), '85mm → about three quarters of the frame (object)');
    assert.equal(focalShotText(85, 'none'), '85mm — shot size not set');
    assert.equal(lookOf({ auto: true, focal: 85 }, '', { subject: 'object' }).subject, 'object');
    assert.equal(lookOf({ auto: true, aperture: 'f/2' }, '', { subject: 'object' }).subject, undefined, 'no focal: nothing to decide');
    assert.equal(lookLabel({ auto: true, focal: 85 }, { shotForFocal: true, subject: 'none' }), '');
    assert.equal(lookLabel({ auto: true, focal: 85 }, { shotForFocal: true, subject: 'object' }), 'shot size: the main object takes about three quarters of the frame');
  } finally { delete globalThis.window; }
});

test('Adapt pictures and the place hint (docs/ux/51 §2)', async () => {
  const { adaptPictures, placeHintNeeded } = await import('../../packages/studio/src/dzCreate.js');
  const file = (tag, role, extra = {}) => ({ tag, kind: 'file', role, url: `/media/u1/${tag}.jpg`, ...extra });
  const el = (tag, kind) => ({ tag, kind: 'element', element: { kind }, url: `/media/e/${tag}.jpg` });
  const tags = [file('start', 'first'), el('char_anna', 'character'), file('img1', 'reference'), el('loc_bar', 'place'), file('img2', 'reference'), file('img3', 'reference', { unused: true })];
  assert.deepEqual(adaptPictures(tags).map((t) => t.tag), ['img1', 'loc_bar'], 'first 2 that are not a character; no frames, no unused');
  const look = { on: true, focal: 85, subject: 'person' };
  const refs = [file('img1', 'reference')];
  assert.equal(placeHintNeeded({ prompt: 'A woman at the bar.', look, tags: refs }), true);
  assert.equal(placeHintNeeded({ prompt: 'A woman at the bar.', look: { ...look, focal: 50 }, tags: refs }), true, 'waist up counts');
  assert.equal(placeHintNeeded({ prompt: 'A woman at the bar.', look: { ...look, focal: 35 }, tags: refs }), false);
  assert.equal(placeHintNeeded({ prompt: 'A woman at the bar.', look: { on: true, aperture: 'f/2' }, tags: refs }), false, 'Auto focal: no hint');
  assert.equal(placeHintNeeded({ prompt: 'A woman.\n\nFRAMING She sits at the left end of the counter.', look, tags: refs }), false);
  assert.equal(placeHintNeeded({ prompt: 'Scene: a bar.\nFraming: at the left end of the counter.', look, tags: refs }), false, 'Adapt writes "Framing:"');
  assert.equal(placeHintNeeded({ prompt: '{"framing": "left end of the counter", "scene": "bar"}', look, tags: refs }), false);
  assert.equal(placeHintNeeded({ prompt: 'A woman at the bar.', look, tags: [el('char_anna', 'character')] }), false, 'only a character');
  assert.equal(placeHintNeeded({ prompt: 'A woman at the bar.', look, tags: refs, startFrame: true }), false);
  assert.equal(placeHintNeeded({ prompt: 'A hand pours into the glass.', look: { ...look, subject: 'none' }, tags: refs }), false);
});

