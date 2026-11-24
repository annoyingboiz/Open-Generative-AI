// "Match colour to source" (docs/ux/research/color-fidelity-answers.md): measure and remove a global cast.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { measureColorShift, applyColorShift, sourceUrlOf, shiftWords, matchedExt, COLOR_MIN_SHIFT } from '../src/color-match.js';
import { versionSuffix } from '../src/generations.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
// A smooth, varied picture (gradients and soft blobs: like a photo, not noise).
async function picture(file, w = 1280, h = 720, seed = 1) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 3;
    buf[i] = 40 + 170 * (x / w) + 20 * Math.sin((x + seed * 37) / 53);
    buf[i + 1] = 60 + 140 * (y / h) + 25 * Math.cos((y + x) / 71);
    buf[i + 2] = 90 + 80 * Math.sin((x * seed) / 211) * Math.cos(y / 97) + 40;
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
  return file;
}

test('a known cast is measured and removed; L* stays; below the threshold nothing is found', async () => {
  const src = await picture(path.join(dir, 'src.png'));
  // The "edit": the source with a cast of a* +2.3, b* −1.8 (made with the same tool, inverted).
  const edit = path.join(dir, 'edit.png');
  await applyColorShift(src, edit, -2.3, 1.8);
  const m = await measureColorShift(src, edit);
  assert.equal(m.ok, true);
  assert.ok(Math.abs(m.da - 2.3) < 0.15 && Math.abs(m.db + 1.8) < 0.15, JSON.stringify(m));
  assert.ok(Math.abs(m.dL) < 0.1);
  assert.ok(m.shift >= COLOR_MIN_SHIFT && m.coverage > 0.9);
  const fixed = path.join(dir, 'fixed.png');
  await applyColorShift(edit, fixed, m.da, m.db);
  const r = await measureColorShift(src, fixed);
  assert.ok(Math.abs(r.da) < 0.15 && Math.abs(r.db) < 0.15 && Math.abs(r.dL) < 0.1, JSON.stringify(r));
  assert.ok(r.shift < COLOR_MIN_SHIFT, 'after matching: no shift found');
  // JPEG q100 4:4:4 output keeps the colour too.
  const jpg = path.join(dir, 'fixed.jpg');
  await applyColorShift(edit, jpg, m.da, m.db);
  const j = await measureColorShift(src, jpg);
  assert.ok(Math.abs(j.da) < 0.15 && Math.abs(j.db) < 0.15, JSON.stringify(j));
  const meta = await sharp(jpg).metadata();
  assert.equal(meta.chromaSubsampling, '4:4:4');
  assert.equal(meta.icc, undefined, 'no carried-over metadata');
});

test('a different shape or a different picture is refused with a reason', async () => {
  const src = await picture(path.join(dir, 'a.png'));
  const square = await picture(path.join(dir, 'sq.png'), 720, 720);
  assert.equal((await measureColorShift(src, square)).reason, 'view');
  // Another picture of the same shape (large blocks of other colours): most of it changed.
  const other = path.join(dir, 'other.png');
  const w = 1280, h = 720; const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const k = ((y / 90) | 0) * 16 + ((x / 80) | 0);
    for (let c = 0; c < 3; c += 1) buf[(y * w + x) * 3 + c] = ((k * 97 + c * 61) * 2654435761 >>> 0) % 256;
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(other);
  const r = await measureColorShift(src, other);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'changed');
});

test('lineage, words, file kind, link version', () => {
  assert.equal(sourceUrlOf({ attached: { edit: [{ url: '/media/g/gen_a/0.jpg' }] } }), '/media/g/gen_a/0.jpg');
  assert.equal(sourceUrlOf({ editor: { source: '/media/u/up_x.png' } }), '/media/u/up_x.png');
  assert.equal(sourceUrlOf({ canvas: { source: '/media/g/gen_b/0.jpg' } }), '/media/g/gen_b/0.jpg');
  assert.equal(sourceUrlOf({ attached: { edit: [{ url: 'https://evil.example/x.jpg' }] } }), null);
  assert.equal(sourceUrlOf({}), null);
  assert.equal(shiftWords(2.3, -1.8), 'magenta +2.3, blue +1.8');
  assert.equal(shiftWords(-1.2, 0.1), 'green +1.2');
  assert.equal(matchedExt('image/png'), 'png');
  assert.equal(matchedExt('image/jpeg'), 'jpg');
  assert.equal(versionSuffix({ color: { v: 3 } }), '-c3');
  assert.equal(versionSuffix({ tex: { v: 2 } }), '-t2');
  assert.equal(versionSuffix({}), '');
});
