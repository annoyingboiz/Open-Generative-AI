// The picture editor's request and prompt (package 12, E5 and E7): pure functions of the
// studio, tested here because the gateway has the test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { numbered, editorPrompt, composerPrompt, requestPictures, summary, barText, sentence } from '../../packages/studio/src/components/editor/editorModel.mjs';

const car = { id: 'o1', kind: 'object', url: '/media/u/car.jpg', name: 'Vintage car', note: 'take only the car, park it here' };
const bike = { id: 'b1', kind: 'brush', note: 'remove the bicycle' };
const lights = { id: 'p1', kind: 'point', note: 'turn the string lights on, warm glow' };
const base = { url: '/media/g/gen_base/0.jpg', w: 2752, h: 1536 };

test('the README example gives the README prompt, word for word', () => {
  assert.equal(editorPrompt({ items: [car, bike, lights] }), [
    'Edit picture 1 (the base). Picture 2 is the same picture with numbered marks: it only shows where each change goes. Picture 3 is @obj1.',
    '1. @obj1: take only the car, park it here.',
    '2. remove the bicycle.',
    '3. turn the string lights on, warm glow.',
    'Do not draw the marks or numbers. Keep everything else unchanged.',
  ].join('\n'));
});

test('pictures: clean base first, the marked copy only with a mark, then each object', () => {
  assert.deepEqual(requestPictures({ base, items: [car, bike], markedUrl: '/m.jpg' }).map((p) => [p.role, p.url]), [['base', base.url], ['marks', '/m.jpg'], ['object', car.url]]);
  assert.deepEqual(requestPictures({ base, items: [car] }).map((p) => p.role), ['base', 'object']);
  assert.match(requestPictures({ base, items: [] })[0].detail, /2752 × 1536/);
  assert.deepEqual(requestPictures({ base, items: [car, bike], flat: true, flatUrl: '/f.jpg' }).map((p) => p.role), ['flat']);
  assert.equal(summary([car, bike, lights]).pictures, 3);
  assert.equal(summary([car]).pictures, 2);
  assert.equal(summary([car, bike], { flat: true }).pictures, 1);
});

test('no marks: no sentence about picture 2, pictures renumbered', () => {
  const p = editorPrompt({ items: [car, { ...car, id: 'o2', url: '/x.jpg', note: '' }], general: 'golden hour' });
  assert.equal(p.split('\n')[0], 'Edit picture 1 (the base). Picture 2 is @obj1. Picture 3 is @obj2.');
  assert.ok(p.includes('2. Add @obj2 here.'));
  assert.ok(p.includes('golden hour.'));
  assert.equal(p.split('\n').at(-1), 'Keep everything else unchanged.');
});

test('removing note 1 of 3 renumbers the others; hidden items get no number', () => {
  const rect = { id: 'r1', kind: 'rect', note: 'a red door' };
  assert.deepEqual(numbered([bike, lights]).map((x) => x.n), [1, 2]);
  assert.deepEqual(numbered([rect, { ...bike, hidden: true }, lights]).map((x) => x.n), [1, null, 2]);
  assert.equal(barText([bike, lights]), '1. remove the bicycle  2. turn the string lights on, warm glow');
});

test('send to composer: @img1 is the marked copy, objects follow, first and last line written out', () => {
  assert.equal(composerPrompt({ items: [car, bike, lights] }), [
    '@img1 is the same picture with numbered marks: it only shows where each change goes.',
    '1. @img2 take only the car, park it here.',
    '2. remove the bicycle.',
    '3. turn the string lights on, warm glow.',
    'Do not draw the marks or numbers. Keep everything else unchanged.',
  ].join('\n'));
  assert.equal(composerPrompt({ items: [car] }), '1. @img1 take only the car, park it here.\nKeep everything else unchanged.');
});

test('a note is one sentence with a full stop', () => {
  assert.equal(sentence('  warm glow  '), 'warm glow.');
  assert.equal(sentence('Done!'), 'Done!');
  assert.equal(sentence(''), '');
});
