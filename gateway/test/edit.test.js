import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stitch, lastFrame } from '../src/edit.js';
import { videoInfo } from '../src/video-upscale.js';

let has = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { has = false; }

test('stitch: clips of different size, with and without sound → one video; last frame', { skip: !has && 'no ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-edit-test-'));
  const a = path.join(dir, 'a.mp4');
  const b = path.join(dir, 'b.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-shortest', '-pix_fmt', 'yuv420p', a]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30:duration=1', '-pix_fmt', 'yuv420p', b]);
  const out = await stitch([{ path: a }, { path: b }]);
  const info = await videoInfo(out.path);
  assert.equal(info.width, 640);
  assert.equal(info.height, 360);
  assert.ok(info.audio, 'keeps a sound track');
  assert.ok(Math.abs(info.duration - 2) < 0.3, `about 2 s, got ${info.duration}`);
  const f = await lastFrame(out.path);
  assert.ok(fs.statSync(f.path).size > 100);
  f.cleanup(); out.cleanup();
  assert.throws(() => stitch([{ path: a }]), /at least two/);
  fs.rmSync(dir, { recursive: true, force: true });
});
