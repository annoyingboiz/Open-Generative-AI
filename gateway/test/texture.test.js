import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { textureGraph, applyTexture, TEXTURE_PRESETS } from '../src/texture.js';
import { videoInfo } from '../src/video-upscale.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-tex-'));
const info = { width: 640, height: 360, fps: 24 };

test('texture: nothing at strength 0 or for an unknown preset; strength scales the effects', () => {
  assert.equal(textureGraph('vhs', 0, info), null);
  assert.equal(textureGraph('modern', 60, info), null);
  assert.equal(textureGraph('16mm', 60, null), null);
  const noise = (g) => Number(/noise=c0s=([\d.]+)/.exec(g.graph)[1]);
  assert.ok(noise(textureGraph('16mm', 100, info)) > noise(textureGraph('16mm', 60, info)));
  assert.ok(noise(textureGraph('16mm', 30, info)) < noise(textureGraph('16mm', 60, info)));
});

test('texture: every preset renders a playable video with the sound kept', async () => {
  const src = path.join(tmp, 'src.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  for (const preset of TEXTURE_PRESETS) {
    const dst = path.join(tmp, `${preset}.mp4`);
    await applyTexture(src, dst, preset, 60, info);
    const i = await videoInfo(dst);
    assert.equal(i.width, 640, preset);
    assert.equal(i.height, 360, preset);
    assert.ok(i.duration > 0.8 && i.duration < 1.3, `${preset}: ${i.duration}`);
    assert.equal(i.audio, true, `${preset}: sound kept`);
    assert.ok(Math.abs(i.fps - 24) < 0.5, `${preset}: frame rate kept`);
  }
});
