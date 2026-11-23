import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { makeCanvas, centreSsim, compositeBack, insetRect, featherMask, DRIFT_SSIM } from '../src/canvas.js';

// A picture with detail (checker + gradients) so SSIM means something.
function picture(W, H) {
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 3; const sq = ((x >> 5) + (y >> 5)) % 2 ? 200 : 40; px[i] = sq; px[i + 1] = (x * 255) / W; px[i + 2] = (y * 255) / H; }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } });
}
const pixel = async (file, x, y) => [...await sharp(file).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-canvas-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Phone canvas (handoff 17, §5.1): the frame at exactly 70 % in the middle of mid grey', async (t) => {
  const tmp = tmpDir(t);
  const W = 640; const H = 360;
  const src = path.join(tmp, 'src.png'); await picture(W, H).png().toFile(src);
  const canvas = path.join(tmp, 'canvas.png'); fs.writeFileSync(canvas, await makeCanvas(src));
  const m = await sharp(canvas).metadata();
  assert.deepEqual([m.width, m.height, m.channels], [W, H, 3], 'same size as the frame, no alpha');
  // 70 % of 640×360 = 448×252, so the frame starts at x 96, y 54 (numbers written out, not from the code).
  assert.deepEqual(await pixel(canvas, 95, 180), [128, 128, 128], 'grey just left of the frame');
  assert.notDeepEqual(await pixel(canvas, 97, 180), [128, 128, 128], 'the frame starts at x 96');
  assert.deepEqual(await pixel(canvas, 320, 53), [128, 128, 128], 'grey just above the frame');
  assert.deepEqual(await pixel(canvas, 544, 180), [128, 128, 128], 'grey just right of the frame (96 + 448)');
  assert.ok(await centreSsim(src, canvas) > 0.97, 'the middle is the source');
});

test('Phone canvas: a JPEG result that drifted gets the source back with an 8 px soft edge, still a JPEG', async (t) => {
  const tmp = tmpDir(t);
  const src = path.join(tmp, 'src.png'); await picture(640, 360).png().toFile(src);
  const drift = path.join(tmp, 'drift.jpg');
  await sharp(await makeCanvas(src)).blur(6).jpeg({ quality: 95 }).toFile(drift);
  const before = await centreSsim(src, drift);
  assert.ok(before < DRIFT_SSIM, `drifted: ${before}`);
  await compositeBack(src, drift);
  assert.equal((await sharp(drift).metadata()).format, 'jpeg');
  assert.ok(await centreSsim(src, drift) > 0.95, 'composited back');
  assert.deepEqual(fs.readdirSync(tmp).sort(), ['drift.jpg', 'src.png'], 'no temporary file left');
});

test('Phone canvas: the soft edge rises from 0 to 255 over 8 px', () => {
  const m = featherMask(40, 30);
  assert.deepEqual([0, 1, 4, 8, 12].map((x) => m[15 * 40 + x]), [0, 32, 128, 255, 255]);
  assert.equal(m[0], 0);
});

test('Phone canvas: where the source sits when the result came back in another shape', () => {
  // Same shape: 70 % of the result.
  assert.deepEqual(insetRect(1280, 720, 16 / 9), { left: 192, top: 108, width: 896, height: 504 });
  // A 4:3 source in a 16:9 result: 4:3, 70 % of the largest 4:3 box (960×720), centred — not stretched.
  assert.deepEqual(insetRect(1280, 720, 4 / 3), { left: 304, top: 108, width: 672, height: 504 });
});

test('Phone canvas: a portrait photo with an EXIF turn is turned upright first', async (t) => {
  const tmp = tmpDir(t);
  // Stored as 360×640 pixels with orientation 6 (turn 90°): upright it is 640×360.
  const src = path.join(tmp, 'turned.jpg');
  await picture(640, 360).rotate(-90).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toFile(src);
  const canvas = path.join(tmp, 'canvas.png'); fs.writeFileSync(canvas, await makeCanvas(src));
  const m = await sharp(canvas).metadata();
  assert.deepEqual([m.width, m.height], [640, 360]);
  assert.ok(await centreSsim(src, canvas) > 0.95, 'checked upright against upright');
});
