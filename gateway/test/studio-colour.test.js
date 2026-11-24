// The colour badge on a picture (docs/ux/research, after color-match-v1): shifted → one-press chip;
// matched → quiet note with Show original; below the threshold or not matchable → nothing on the tile.
import test from 'node:test';
import assert from 'node:assert/strict';

test('colour chip and the viewer line follow the measurement and the match', async () => {
  const { colourChip, checkBadges, shiftText } = await import('../../packages/studio/src/components/studio/actions.js');
  const shifted = { kind: 'image', status: 'completed', checks: { colour: { state: 'shifted', da: 2.3, db: -1.8 } } };
  assert.deepEqual(colourChip(shifted), { state: 'shifted', text: 'Colour shifted from source', action: 'Match', to: 'match', note: 'magenta +2.3, blue +1.8' });
  assert.equal(checkBadges(shifted).find((b) => b.id === 'colour')?.text, 'Colour shifted from source');
  assert.equal(checkBadges(shifted).find((b) => b.id === 'colour')?.noRetry, true);
  const matched = { ...shifted, colour: { on: true } };
  assert.equal(colourChip(matched).text, 'Colour matched');
  assert.equal(colourChip(matched).action, 'Show original');
  assert.equal(checkBadges(matched).some((b) => b.id === 'colour'), false, 'no warning once matched');
  assert.equal(colourChip({ ...shifted, colour: { on: false } }).action, 'Use matched');
  assert.equal(colourChip({ kind: 'image', checks: { colour: { state: 'none' } } }), null, 'below the threshold: nothing');
  assert.equal(colourChip({ kind: 'image', checks: { colour: { state: 'unavailable', reason: 'x' } } }), null, 'not matchable: nothing on the tile');
  assert.equal(colourChip({ kind: 'video', checks: { colour: { state: 'shifted' } } }), null);
  assert.equal(shiftText(-1.2, 0.5), 'green +1.2, yellow +0.5');
  // Made with a look or re-shot: intended colour, no tile badge and no warning line (color-badge-review.md §3).
  const looked = { ...shifted, meta: { look: { on: true, camera: 'super8' } } };
  assert.equal(colourChip(looked), null);
  assert.equal(checkBadges(looked).some((b) => b.id === 'colour'), false);
  assert.equal(colourChip({ ...shifted, meta: { look: { on: false, filter: 'teal-orange' } } }), null, 'a colour filter alone counts');
  assert.equal(colourChip({ ...shifted, meta: { reshootOf: '/media/g/gen_a/0.jpg' } }), null);
  assert.equal(colourChip({ ...shifted, meta: { look: { on: false } } })?.state, 'shifted', 'an empty look does not');
  assert.equal(colourChip({ ...looked, colour: { on: true } })?.text, 'Colour matched', 'once matched by hand, the note shows');
});
