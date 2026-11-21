// The picture editor's request and prompt (package 12, E5 and E7): pure functions of the
// studio, tested here because the gateway has the test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { numbered, editorPrompt, requestPrompt, composerPrompt, requestPictures, summary, barText, sentence } from '../../packages/studio/src/components/editor/editorModel.mjs';

const car = { id: 'o1', kind: 'object', url: '/media/u/car.jpg', name: 'Vintage car', note: 'take only the car, park it here' };
const bike = { id: 'b1', kind: 'brush', note: 'remove the bicycle' };
const lights = { id: 'p1', kind: 'point', note: 'turn the string lights on, warm glow' };
const base = { url: '/media/g/gen_base/0.jpg', w: 2752, h: 1536 };

const neon = { id: 'r1', kind: 'rect', note: 'hang a neon sign here, like @ref_aa1', refs: [{ id: 'ref_aa1', url: '/media/u/neon.jpg', name: 'neon' }] };
const car2 = { ...car, id: 'o2' };

test('package 13 C4: the README example gives the README prompt, word for word', () => {
  const items = [neon, car2, bike, lights];
  assert.equal(editorPrompt({ items }), [
    'Edit image 1 (the base). Image 2 is the same picture with numbered marks: it only shows where each change goes. Image 3 is an object to place. Image 4 is a reference for change 1.',
    '1. hang a neon sign here, like image 4.',
    '2. image 3: take only the car, park it here.',
    '3. remove the bicycle.',
    '4. turn the string lights on, warm glow.',
    'Do not draw the marks or numbers. Keep the size and proportions of image 1. Keep everything else unchanged.',
  ].join('\n'));
  // The engine form: @edit, then @img1… in the order of the files.
  assert.equal(requestPrompt({ items }).split('\n').slice(0, 3).join('\n'), [
    'Edit @edit (the base). @img1 is the same picture with numbered marks: it only shows where each change goes. @img2 is an object to place. @img3 is a reference for change 1.',
    '1. hang a neon sign here, like @img3.',
    '2. @img2: take only the car, park it here.',
  ].join('\n'));
  assert.deepEqual(requestPictures({ base, items, markedUrl: '/m.jpg' }).map((p) => p.role), ['base', 'marks', 'object', 'reference']);
  assert.equal(summary(items).pictures, 4);
  assert.equal(summary(items).refs, 1);
});

test('references: a removed chip removes the reference; tags follow the notes; hidden ones are not sent', () => {
  const two = { id: 'r2', kind: 'rect', note: 'like @ref_bb1 and @ref_bb2', refs: [{ id: 'ref_bb1', url: '/a.jpg' }, { id: 'ref_bb2', url: '/b.jpg' }, { id: 'ref_bb3', url: '/c.jpg' }] };
  const list = numbered([neon, two]);
  assert.deepEqual(list[1].refs.map((x) => x.tag), ['ref2', 'ref3']);
  assert.equal(barText([neon, two]), '1. hang a neon sign here, like @ref1  2. like @ref2 and @ref3');
  assert.equal(summary([{ ...neon, hidden: true }, two]).refs, 2);
  assert.equal(numbered([neon, two])[0].label, 'Rectangle');
  assert.equal(numbered([car, car2])[1].label, 'Object 2');
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

test('no marks: no sentence about the marked copy, pictures renumbered', () => {
  const p = editorPrompt({ items: [car, { ...car, id: 'o2', url: '/x.jpg', note: '' }], general: 'golden hour' });
  assert.equal(p.split('\n')[0], 'Edit image 1 (the base). Image 2 is an object to place. Image 3 is an object to place.');
  assert.ok(p.includes('2. Add image 3 here.'));
  assert.ok(p.includes('golden hour.'));
  assert.equal(p.split('\n').at(-1), 'Keep the size and proportions of image 1. Keep everything else unchanged.');
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

test('the request uses the engine tags: @edit is the base, @img1 the marked copy, @img2… the pictures', () => {
  assert.equal(requestPrompt({ items: [car, bike, lights] }), [
    'Edit @edit (the base). @img1 is the same picture with numbered marks: it only shows where each change goes. @img2 is an object to place.',
    '1. @img2: take only the car, park it here.',
    '2. remove the bicycle.',
    '3. turn the string lights on, warm glow.',
    'Do not draw the marks or numbers. Keep the size and proportions of @edit. Keep everything else unchanged.',
  ].join('\n'));
  // No marks: the pictures start at @img1.
  assert.equal(requestPrompt({ items: [car] }), 'Edit @edit (the base). @img1 is an object to place.\n1. @img1: take only the car, park it here.\nKeep the size and proportions of @edit. Keep everything else unchanged.');
  assert.equal(requestPrompt({ items: [bike], flat: true }).split('\n')[0], 'Edit @edit. The numbers on it only show which note applies where.');
  // Flat: references still go as their own files.
  assert.equal(requestPrompt({ items: [neon], flat: true }).split('\n')[0], 'Edit @edit. The numbers on it only show which note applies where. @img1 is a reference for change 1.');
});

test('a tag that opens a sentence gets a capital; one after a list number does not', async () => {
  const { translateTags } = await import('../../packages/studio/src/dzCreate.js');
  const tags = [{ tag: 'edit', to: 'image 1' }, { tag: 'img1', to: 'image 2' }, { tag: 'img2', to: 'image 3' }];
  assert.equal(translateTags('Edit @edit (the base). @img1 is marks.\n1. @img2: car.\n@img1 too', tags), 'Edit image 1 (the base). Image 2 is marks.\n1. image 3: car.\nImage 2 too');
});
