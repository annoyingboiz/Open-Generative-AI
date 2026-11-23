// Phone "re-shoot" (handoff 17, §5.1): the frame is made wider by canvas extension.
// 1) The user's frame shrunk to 70 % in the middle of a mid-grey canvas of its own size;
// 2) the image model fills the grey (prompt: look.js canvasPrompt);
// 3) the middle of the result is checked against the source (SSIM on grey levels); only when it
//    drifted (below DRIFT_SSIM) the 70 % source is put back over the middle with a soft edge.
// Threshold from the design chat's six results on the ramen frame: 0.929–0.985 (five at 0.984+);
// an unrelated picture of the same scene scores about 0.09.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CANVAS_SCALE } from './look.js';

export const DRIFT_SSIM = 0.95;
const GREY = { r: 128, g: 128, b: 128 };

// The source upright (EXIF orientation applied) and without alpha, with its real size.
async function upright(srcPath) {
  const { data, info } = await sharp(srcPath).rotate().flatten({ background: GREY }).png().toBuffer({ resolveWithObject: true });
  return { buf: data, W: info.width, H: info.height };
}

// Where the source sits in a result of RW×RH: its own shape, 70 % of the largest box of that
// shape that fits, centred. Same as 70 % of the result when the result kept the canvas's shape.
export function insetRect(RW, RH, aspect) {
  const fitW = Math.min(RW, RH * aspect); const fitH = fitW / aspect;
  const w = Math.max(1, Math.round(fitW * CANVAS_SCALE)); const h = Math.max(1, Math.round(fitH * CANVAS_SCALE));
  return { left: Math.round((RW - w) / 2), top: Math.round((RH - h) / 2), width: w, height: h };
}

// A copy of the source as the check will see it (upright PNG), kept with the job.
export async function uprightPng(srcPath) { return (await upright(srcPath)).buf; }

export async function makeCanvas(srcPath) {
  const { buf, W, H } = await upright(srcPath);
  const r = insetRect(W, H, W / H);
  const inner = await sharp(buf).resize(r.width, r.height, { fit: 'fill' }).toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: GREY } })
    .composite([{ input: inner, left: r.left, top: r.top }])
    .removeAlpha().png().toBuffer();
}

// One grey byte per pixel, exactly tw×th.
async function grey(input, tw, th, extract) {
  let img = sharp(input).rotate();
  if (extract) img = img.extract(extract);
  const { data, info } = await img.flatten({ background: GREY }).resize(tw, th, { fit: 'fill' }).greyscale().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || data.length !== tw * th) throw new Error(`grey levels: got ${data.length} bytes for ${tw}×${th}`);
  return data;
}

// Grey levels of the source and of where it sits in `resultPath`, both at tw px wide.
async function middles(srcPath, resultPath, tw = 320) {
  const src = await upright(srcPath);
  const rm = await sharp(resultPath).rotate().metadata();
  const [RW, RH] = (rm.orientation || 1) >= 5 ? [rm.height, rm.width] : [rm.width, rm.height];
  const r = insetRect(RW, RH, src.W / src.H);
  const th = Math.max(8, Math.round((r.height * tw) / r.width));
  return { a: await grey(src.buf, tw, th), b: await grey(resultPath, tw, th, r), tw, th };
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

// The source back over where it sits in the result, with an 8 px soft edge; the result file is
// replaced in place (same format, written next to it first, then renamed).
export function featherMask(w, h, f = 8) {
  const mask = Buffer.alloc(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      mask[y * w + x] = Math.round(255 * Math.min(1, d / f));
    }
  }
  return mask;
}

export async function compositeBack(srcPath, resultPath) {
  const src = await upright(srcPath);
  const { data: res, info } = await sharp(resultPath).rotate().toBuffer({ resolveWithObject: true });
  const r = insetRect(info.width, info.height, src.W / src.H);
  const inner = await sharp(src.buf).resize(r.width, r.height, { fit: 'fill' }).removeAlpha()
    .joinChannel(featherMask(r.width, r.height), { raw: { width: r.width, height: r.height, channels: 1 } }).png().toBuffer();
  const out = await sharp(res).composite([{ input: inner, left: r.left, top: r.top }]).toFormat(info.format, /^(jpeg|webp|avif)$/.test(info.format) ? { quality: 92 } : {}).toBuffer();
  const tmp = path.join(path.dirname(resultPath), `.${path.basename(resultPath)}.${process.pid}.${Date.now()}.part`);
  try {
    await fs.promises.writeFile(tmp, out);
    await fs.promises.rename(tmp, resultPath);
  } finally { await fs.promises.rm(tmp, { force: true }); }
}
