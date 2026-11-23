import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { makeCanvas, centreSsim, compositeBack, DRIFT_SSIM } from '../src/canvas.js';

test('Phone canvas (handoff 17, §5.1): 70 % in the middle of grey, centre check, composite back', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-canvas-'));
  const src = path.join(tmp, 'src.png');
  // A picture with detail (gradient + squares) so SSIM means something.
  const W = 640; const H = 360; const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 3; const sq = ((x >> 5) + (y >> 5)) % 2 ? 200 : 40; px[i] = sq; px[i + 1] = (x * 255) / W; px[i + 2] = (y * 255) / H; }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(src);
  const canvas = path.join(tmp, 'canvas.png');
  fs.writeFileSync(canvas, await makeCanvas(src));
  const m = await sharp(canvas).metadata();
  assert.deepEqual([m.width, m.height], [W, H], 'same size and ratio as the frame');
  const corner = await sharp(canvas).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...corner], [128, 128, 128], 'mid grey around');
  assert.ok(await centreSsim(src, canvas) > 0.97, 'the middle is the source');
  // A result whose middle drifted (blurred) scores lower and gets the source put back.
  const drift = path.join(tmp, 'drift.png');
  await sharp(canvas).blur(6).toFile(drift);
  const before = await centreSsim(src, drift);
  assert.ok(before < DRIFT_SSIM, `drifted: ${before}`);
  await compositeBack(src, drift);
  assert.ok(await centreSsim(src, drift) > 0.95, 'composited back');
});
