import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChanges, diffInputs, diffOverride, diffSnapshots, snapshotOf } from '../src/catalog/changes.js';
import { buildApimartOverrides } from '../src/catalog/apimart-docs.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dz-changes-'));
const dur = (values, def = values[0]) => ({ name: 'duration', type: 'int', enum: values, default: def });
const ov = (inputs, media = null) => ({
  rename: { aspect_ratio: 'size' },
  common: { inputs },
  modes: { t2v: { inputs: {} }, ...(media ? { i2v: { inputs: {}, media: { image: media } } } : {}) },
});

test('diffInputs: added values are safe, removed values and new settings are not', () => {
  const items = diffInputs({ duration: dur([5, 10]) }, { duration: dur([5, 10, 15]), audio: { type: 'boolean', default: true } });
  const added = items.find((i) => i.type === 'values-added');
  assert.equal(added.detail, '15');
  assert.equal(added.safe, true);
  assert.equal(items.find((i) => i.type === 'param-added').safe, false);

  const removed = diffInputs({ duration: dur([5, 10]) }, { duration: dur([5]) });
  assert.equal(removed.find((i) => i.type === 'values-removed').safe, false);
});

test('diffInputs: wider range is safe, narrower is not; no change → nothing', () => {
  const r = (lo, hi) => ({ seconds: { type: 'int', minValue: lo, maxValue: hi, default: lo } });
  assert.equal(diffInputs(r(4, 10), r(3, 15))[0].safe, true);
  assert.equal(diffInputs(r(4, 10), r(5, 10)).some((i) => i.type === 'range-changed' && !i.safe), true);
  assert.deepEqual(diffInputs(r(4, 10), r(4, 10)), []);
  // Enum order does not matter.
  assert.deepEqual(diffInputs({ d: dur([5, 10]) }, { d: dur([10, 5], 5) }), []);
});

test('diffOverride: media limits and modes', () => {
  const before = ov({ duration: dur([5]) }, { field: 'image_urls', max: 4 });
  assert.equal(diffOverride(before, ov({ duration: dur([5]) }, { field: 'image_urls', max: 9 }))[0].safe, true);
  const lost = diffOverride(before, ov({ duration: dur([5]) }));
  assert.equal(lost[0].type, 'mode-removed');
  assert.equal(lost[0].safe, false);
  assert.equal(diffOverride(undefined, before)[0].type, 'model-added');
  assert.equal(diffOverride(before, undefined)[0].info, true);
});

test('APIMart docs check: safe changes go live, others wait; dismiss and apply', () => {
  const changes = createChanges({ dir: tmp() });
  const bundled = {
    a: ov({ duration: dur([5, 10]) }),
    b: ov({ duration: dur([5, 10]) }),
    c: ov({ duration: dur([5]) }),
  };
  const fresh = {
    a: ov({ duration: dur([5, 10, 15]) }), // new value → live
    b: ov({ duration: dur([5]) }), // value removed → review
    c: ov({ duration: dur([5]) }), // same
  };
  const added = changes.apimartDocsChecked(fresh, bundled, { total: 3, failed: 0 });
  assert.deepEqual(added.map((e) => [e.model, e.status]).sort(), [['a', 'applied'], ['b', 'review']]);
  assert.deepEqual(Object.keys(changes.liveOverrides()), ['a']);
  assert.deepEqual(Object.keys(changes.pendingOverrides()), ['b']);
  assert.equal(changes.summary().review, 1);

  // Same docs again: nothing new is recorded.
  assert.equal(changes.apimartDocsChecked(fresh, bundled, { total: 3 }).length, 0);

  // Keep current → not proposed again for the same docs.
  assert.equal(changes.dismissPending('b'), true);
  assert.equal(changes.summary().review, 0);
  assert.equal(changes.apimartDocsChecked(fresh, bundled, { total: 3 }).length, 0);

  // Different docs for b → proposed again; apply moves it live.
  const fresh2 = { ...fresh, b: ov({ duration: dur([6]) }) };
  assert.equal(changes.apimartDocsChecked(fresh2, bundled, { total: 3 }).some((e) => e.model === 'b' && e.status === 'review'), true);
  assert.equal(changes.applyPending('b'), true);
  assert.deepEqual(Object.keys(changes.liveOverrides()).sort(), ['a', 'b']);
  assert.equal(changes.summary().review, 0);
});

test('APIMart docs check: half-loaded docs change nothing', () => {
  const changes = createChanges({ dir: tmp() });
  const bundled = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`m${i}`, ov({ duration: dur([5]) })]));
  const fresh = { m0: ov({ duration: dur([5, 10]) }) };
  const added = changes.apimartDocsChecked(fresh, bundled, { total: 10, failed: 9 });
  assert.equal(added[0].type, 'check-skipped');
  assert.deepEqual(changes.liveOverrides(), {});
});

test('catalog snapshots: first one is only saved, then differences are journaled', () => {
  const changes = createChanges({ dir: tmp() });
  const v = (key, inputs, price) => ({ key, mode: 't2v', provider: 'atlas', model: { dzFamilyName: 'Kling', inputs, dzPrice: { label: price } } });
  assert.equal(changes.catalogChecked('atlas', [v('p/atlas/k', { duration: dur([5]) }, '$0.10/s')]).length, 0);
  const added = changes.catalogChecked('atlas', [v('p/atlas/k', { duration: dur([5, 10]) }, '$0.12/s'), v('p/atlas/new', {}, '$1')]);
  assert.deepEqual(added.map((e) => e.type).sort(), ['model-added', 'price-changed', 'values-added']);
  assert.ok(added.every((e) => e.status === 'applied'));
  // An empty answer is an outage, not "everything removed".
  assert.equal(changes.catalogChecked('atlas', []).length, 0);
  assert.equal(diffSnapshots(snapshotOf([v('x', {}, '$1')]), {}).at(0).type, 'model-removed');
});

test('provider refusals are journaled once a day per endpoint and message', () => {
  const changes = createChanges({ dir: tmp() });
  const r = { provider: 'apimart', endpoint: 'p/apimart/x?m=t2v', model: 'x', status: 400, message: 'HTTP 400: invalid duration' };
  assert.equal(changes.providerRejected(r).length, 1);
  assert.equal(changes.providerRejected(r).length, 0);
  const [entry] = changes.list();
  assert.equal(changes.providerRejected({ ...r, message: 'HTTP 400: prompt violates content policy' }).length, 0);
  assert.equal(changes.close(entry.id), true);
  assert.equal(changes.summary().review, 0);
});

test('docs parser: values, ranges and media from a page', () => {
  const page = `# Demo Video Generation

## Request parameters

**model** \`string\` required
Model name: \`demo-video\`

**duration** \`integer\` (default: 5)
Video length. Values: \`5\`, \`10\`

**size** \`string\`
Aspect ratio. Values: \`16:9\`, \`9:16\`, \`1:1\`

**image_urls** \`array\`
Reference images, up to \`7\`

## Response
`;
  const out = buildApimartOverrides([{ url: 'https://docs.apimart.ai/en/api-reference/videos/demo/generation.md', text: page }]);
  const o = out['demo-video'];
  assert.deepEqual(o.common.inputs.duration.enum, [5, 10]);
  assert.deepEqual(o.common.inputs.aspect_ratio.enum, ['16:9', '9:16', '1:1']);
  assert.equal(o.rename.aspect_ratio, 'size');
  assert.equal(o.modes.i2v.media.image.max, 7);
});
