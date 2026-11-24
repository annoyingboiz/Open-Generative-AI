// Cut check (docs/ux/44 b): thresholds measured on 37 clips in REPORT-shot-size.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutScore, CUT_W, CUT_H, driftZoom, shotFromFace, DRIFT_W, DRIFT_H } from '../src/media.js';

const size = CUT_W * CUT_H;
// n frames of a slowly drifting picture; `jump` replaces the picture from frame `at` on.
function clip(n, { at = -1, jump = 0, noise = 0.6 } = {}) {
  const buf = new Uint8Array(n * size);
  for (let f = 0; f < n; f += 1) {
    for (let k = 0; k < size; k += 1) {
      const base = (k * 7 + f * noise) % 200;
      buf[f * size + k] = at >= 0 && f >= at ? (base + jump) % 256 : base;
    }
  }
  return buf;
}

test('a hard cut is found at its frame; a slow drift or a steady clip is not a cut', () => {
  const cut = cutScore(clip(97, { at: 49, jump: 60 }));
  assert.equal(cut.cut, true);
  assert.deepEqual(cut.cuts, [49]);
  assert.ok(cut.max > 8 && cut.max / cut.p90 > 4);
  // Two cuts: both reported (the rule compares with the clip's usual change, not the second-largest).
  const two = clip(97, { at: 49, jump: 60 });
  for (let f = 73; f < 97; f += 1) for (let k = 0; k < size; k += 1) two[f * size + k] = (two[f * size + k] + 90) % 256;
  assert.deepEqual(cutScore(two).cuts, [49, 73]);
  // A one-frame flash: in and out again — not a cut.
  const flash = clip(97);
  for (let k = 0; k < size; k += 1) flash[40 * size + k] = 255;
  assert.deepEqual(cutScore(flash).cuts, []);
  assert.equal(cutScore(clip(97)).cut, false);
  // A strong but even change on every frame (fast camera move): large, but not 4× the next one.
  assert.equal(cutScore(clip(97, { noise: 12 })).cut, false);
  assert.equal(cutScore(new Uint8Array(size * 2)).cut, false, 'too short to judge');
});

test('drift: a synthetic 20 % pull-back is measured; a still or a black picture is 1.0', async () => {
  const w = DRIFT_W; const h = DRIFT_H; const size = w * h;
  const base = (x, y) => 128 + 60 * Math.sin(x / 7) * Math.cos(y / 5) + 40 * Math.sin((x + y) / 11);
  const frames = (n, zoomAt) => {
    const buf = new Uint8Array(n * size);
    for (let f = 0; f < n; f += 1) { const z = zoomAt(f); for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) buf[f * size + y * w + x] = base(w / 2 + (x - w / 2) / z, h / 2 + (y - h / 2) / z); }
    return buf;
  };
  assert.ok(Math.abs((await driftZoom(frames(9, () => 1))).zoom - 1) < 0.01);
  assert.equal((await driftZoom(new Uint8Array(20 * size))).zoom, 1, 'black clip: no drift');
  const z = (await driftZoom(frames(9, (f) => 1 - 0.2 * f / 8))).zoom;
  assert.ok(Math.abs(z - 0.8) < 0.03, String(z));
});

test('shot size from the face box (fit on 136 measured frames)', () => {
  assert.equal(shotFromFace(48, 144, 344).id, 'head-shoulders'); // N3: head 57 %, cut at the chest
  assert.equal(shotFromFace(75, 43, 344).id, 'knees');           // N2: cut at the thigh
  assert.equal(shotFromFace(60, 30, 341).id, 'full');            // N1 at 0 s: 6.0 head units, feet at the edge
  assert.equal(shotFromFace(20, 300, 360).id, 'face');
});
