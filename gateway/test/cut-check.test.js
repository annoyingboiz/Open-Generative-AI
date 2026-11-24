// Cut check (docs/ux/44 b): thresholds measured on 37 clips in REPORT-shot-size.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutScore, CUT_W, CUT_H } from '../src/media.js';

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
  assert.equal(cut.at_frame, 49);
  assert.ok(cut.max > 8 && cut.max / cut.second > 4);
  assert.equal(cutScore(clip(97)).cut, false);
  // A strong but even change on every frame (fast camera move): large, but not 4× the next one.
  assert.equal(cutScore(clip(97, { noise: 12 })).cut, false);
  assert.equal(cutScore(new Uint8Array(size * 2)).cut, false, 'too short to judge');
});
