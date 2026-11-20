import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { needsFaststart, faststart, topBoxes } from '../src/media.js';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('faststart moves the index in front of the data without re-encoding', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-media-'));
  const file = path.join(dir, 'a.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  assert.equal(needsFaststart(file), true);
  const before = fs.statSync(file).size;
  assert.equal(await faststart(file), true);
  assert.equal(needsFaststart(file), false);
  const boxes = topBoxes(file).map((b) => (typeof b === 'string' ? b : b.type));
  assert.ok(boxes.indexOf('moov') < boxes.indexOf('mdat'));
  assert.ok(Math.abs(fs.statSync(file).size - before) < 4096);
  assert.equal(await faststart(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
