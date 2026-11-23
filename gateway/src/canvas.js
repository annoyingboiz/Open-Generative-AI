// Phone "re-shoot" (handoff 17, §5.1): the frame is made wider by canvas extension.
// 1) The user's frame shrunk to 70 % in the middle of a mid-grey canvas of its own size;
// 2) the image model fills the grey (prompt: look.js canvasPrompt);
// 3) the middle of the result is checked against the source (SSIM on grey levels); only when it
//    drifted (below DRIFT_SSIM) the 70 % source is put back over the middle with a soft edge.
// Threshold from the design chat's six results on the ramen frame: 0.929–0.985 (five at 0.984+);
// an unrelated picture of the same scene scores about 0.09.
import sharp from 'sharp';
import { CANVAS_SCALE } from './look.js';

export const DRIFT_SSIM = 0.95;
const GREY = { r: 128, g: 128, b: 128 };

export async function makeCanvas(srcPath) {
  const meta = await sharp(srcPath).rotate().metadata();
  const W = meta.width; const H = meta.height;
  const w = Math.round(W * CANVAS_SCALE); const h = Math.round(H * CANVAS_SCALE);
  const inner = await sharp(srcPath).rotate().resize(w, h, { fit: 'fill' }).toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: GREY } })
    .composite([{ input: inner, left: Math.round((W - w) / 2), top: Math.round((H - h) / 2) }])
    .removeAlpha().png().toBuffer();
}

// Grey levels of the middle of `resultPath` and of the source, both at tw px wide.
async function middles(srcPath, resultPath, tw = 320) {
  const rm = await sharp(resultPath).metadata();
  const w = Math.round(rm.width * CANVAS_SCALE); const h = Math.round(rm.height * CANVAS_SCALE);
  const th = Math.max(8, Math.round((h * tw) / w));
  const a = await sharp(srcPath).rotate().resize(tw, th, { fit: 'fill' }).greyscale().raw().toBuffer();
  const b = await sharp(resultPath).extract({ left: Math.round((rm.width - w) / 2), top: Math.round((rm.height - h) / 2), width: w, height: h })
    .resize(tw, th, { fit: 'fill' }).greyscale().raw().toBuffer();
  return { a, b, tw, th };
}

// Mean SSIM over 7×7 windows (box filter), as in the threshold measurement.
export function ssim(a, b, w, h) {
  const C1 = (0.01 * 255) ** 2; const C2 = (0.03 * 255) ** 2; const r = 3;
  let sum = 0; let n = 0;
  for (let y = r; y < h - r; y += 1) {
    for (let x = r; x < w - r; x += 1) {
      let ma = 0; let mb = 0; let aa = 0; let bb = 0; let ab = 0; let k = 0;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const i = (y + dy) * w + x + dx; const va = a[i]; const vb = b[i];
          ma += va; mb += vb; aa += va * va; bb += vb * vb; ab += va * vb; k += 1;
        }
      }
      ma /= k; mb /= k;
      const sa = aa / k - ma * ma; const sb = bb / k - mb * mb; const sab = ab / k - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * sab + C2)) / ((ma * ma + mb * mb + C1) * (sa + sb + C2)); n += 1;
    }
  }
  return n ? sum / n : 0;
}

export async function centreSsim(srcPath, resultPath) {
  const { a, b, tw, th } = await middles(srcPath, resultPath);
  return ssim(a, b, tw, th);
}

// The 70 % source over the middle of the result, with an 8 px soft edge; written in place.
export async function compositeBack(srcPath, resultPath) {
  const rm = await sharp(resultPath).metadata();
  const w = Math.round(rm.width * CANVAS_SCALE); const h = Math.round(rm.height * CANVAS_SCALE);
  const f = 8; // soft edge: alpha rises from 0 to 255 over f px inside the border
  const mask = Buffer.alloc(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      mask[y * w + x] = Math.round(255 * Math.min(1, d / f));
    }
  }
  const inner = await sharp(srcPath).rotate().resize(w, h, { fit: 'fill' }).removeAlpha().joinChannel(mask, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const out = await sharp(resultPath).composite([{ input: inner, left: Math.round((rm.width - w) / 2), top: Math.round((rm.height - h) / 2) }]).toBuffer();
  await sharp(out).toFile(`${resultPath}.tmp`);
  const fs = await import('node:fs');
  fs.renameSync(`${resultPath}.tmp`, resultPath);
}
