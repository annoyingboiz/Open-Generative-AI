// "Match colour to source" (docs/ux/research/color-fidelity-answers.md, version 1).
//
// An edited picture can come back with a global colour cast (Nano Banana Pro at 4K: about +2.3 a*,
// −1.8 b* per edit, adding up along a chain; color-fidelity-dev-check.md). This measures the cast
// against the colour anchor (the first picture of the edit chain) on the parts that did not change,
// and removes it from the whole result. By button only; nothing is hard-coded per model.
//
// Measure: both pictures to 640 px wide (the anchor's aspect), sRGB → CIELAB (D65), means of 8×8-px
// cells, cells whose L* differs by more than 8 (changed content) or that are near black or clipped
// are dropped; medians of ΔL*, Δa*, Δb* over the rest. Apply: a*/b* moved back by the medians on
// every pixel of the full-size result, in float; L* stays. A pixel that would leave the sRGB gamut
// gets a smaller correction (never a per-channel clip, which would turn its hue). Any size. Output in
// the result's own kind: a PNG/WebP result stays lossless (PNG); a JPEG result becomes JPEG q100 with
// full-resolution colour (4:4:4): colour moves by < 0.01, mean error 0.1 level (q95: 0.75), about 2/3 of a PNG (4K: 13 vs 18.5 MB).
import sharp from 'sharp';

export const COLOR_ALGO = 'lab-median-ab-v1';
export const COLOR_MIN_SHIFT = 1.0;   // √(Δa*² + Δb*²) below this: "No colour shift found"
export const COLOR_MIN_COVERAGE = 0.4; // share of unchanged cells needed to trust the measurement
const SMALL = 640;      // the longer side of the measuring copy
const CELL = 8;
const DL_MAX = 8;        // mean ΔL* of a cell: more is changed content
const DL_ABS_MAX = 10;   // mean |ΔL*| per pixel of a cell: more is changed structure (same average, other content)
const CHROMA_OUT = 4;    // a cell's Δa*/Δb* this far from the first median: an outlier (a recoloured object)
export const COLOR_MAX_PIXELS = 50_000_000; // a bigger picture is refused (memory: two RGB copies in RAM)

// ── sRGB ↔ CIELAB (D65) ─────────────────────────────────────────────
const TO_LIN = new Float64Array(256);
for (let i = 0; i < 256; i += 1) { const c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const LUT_N = 65535;
const TO_SRGB8 = new Float64Array(LUT_N + 1); // linear (0..1, 65536 steps) → sRGB 0..255 (float)
for (let i = 0; i <= LUT_N; i += 1) { const c = i / LUT_N; TO_SRGB8[i] = 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); }
const XN = 0.95047, ZN = 1.08883;
const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116);
const finv = (t) => (t > 0.206896551724 ? t * t * t : (t - 16 / 116) / 7.787037037);

function labOf(r8, g8, b8, out) {
  const r = TO_LIN[r8], g = TO_LIN[g8], b = TO_LIN[b8];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
}

async function smallRgb(path, w, h) {
  const { data } = await sharp(path, { limitInputPixels: COLOR_MAX_PIXELS }).rotate().removeAlpha().toColourspace('srgb')
    .resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return data;
}
async function sizeOf(path) {
  const m = await sharp(path, { limitInputPixels: COLOR_MAX_PIXELS }).metadata();
  // EXIF orientations 5–8 swap width and height.
  return m.orientation >= 5 ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
}
const median = (arr) => { const s = Float64Array.from(arr).sort(); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

// { ok, reason?, dL, da, db, shift, coverage, cells }
export async function measureColorShift(anchorPath, resultPath) {
  let A, R, a, r, w, h;
  try {
    [A, R] = await Promise.all([sizeOf(anchorPath), sizeOf(resultPath)]);
    if (!A.w || !R.w || A.w * A.h > COLOR_MAX_PIXELS || R.w * R.h > COLOR_MAX_PIXELS) return { ok: false, reason: 'unreadable' };
    if (Math.abs(A.w / A.h - R.w / R.h) / (A.w / A.h) > 0.01) return { ok: false, reason: 'view' };
    // The longer side to 640 px, both sides whole cells (Codex x70: a tall picture stays small too).
    const k = SMALL / Math.max(A.w, A.h);
    w = Math.max(CELL, Math.round((A.w * k) / CELL) * CELL); h = Math.max(CELL, Math.round((A.h * k) / CELL) * CELL);
    [a, r] = await Promise.all([smallRgb(anchorPath, w, h), smallRgb(resultPath, w, h)]);
  } catch { return { ok: false, reason: 'unreadable' }; }
  const cw = w / CELL, ch = h / CELL, n = cw * ch;
  const sa = new Float64Array(n * 3), sr = new Float64Array(n * 3), adL = new Float64Array(n);
  const la = [0, 0, 0], lr = [0, 0, 0];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3, c = ((y / CELL) | 0) * cw + ((x / CELL) | 0);
      labOf(a[i], a[i + 1], a[i + 2], la); labOf(r[i], r[i + 1], r[i + 2], lr);
      for (let k = 0; k < 3; k += 1) { sa[c * 3 + k] += la[k]; sr[c * 3 + k] += lr[k]; }
      adL[c] += Math.abs(lr[0] - la[0]);
    }
    if (y % 64 === 63) await new Promise((resolve) => setImmediate(resolve));
  }
  const per = CELL * CELL;
  let cells = [];
  for (let c = 0; c < n; c += 1) {
    const L0 = sa[c * 3] / per, L1 = sr[c * 3] / per;
    // Near black or clipped on either side, or changed: the mean or the structure of its lightness.
    if (L0 < 4 || L0 > 97 || L1 < 4 || L1 > 97 || Math.abs(L1 - L0) > DL_MAX || adL[c] / per > DL_ABS_MAX) continue;
    cells.push([L1 - L0, (sr[c * 3 + 1] - sa[c * 3 + 1]) / per, (sr[c * 3 + 2] - sa[c * 3 + 2]) / per]);
  }
  // A recoloured object with the same lightness: far from the common shift, dropped (one pass).
  if (cells.length) {
    const ma = median(cells.map((x) => x[1])), mb = median(cells.map((x) => x[2]));
    cells = cells.filter((x) => Math.hypot(x[1] - ma, x[2] - mb) <= CHROMA_OUT);
  }
  const coverage = cells.length / n;
  const out = { cells: cells.length, coverage: Math.round(coverage * 1000) / 1000 };
  if (coverage < COLOR_MIN_COVERAGE) return { ok: false, reason: 'changed', ...out };
  const m = { dL: median(cells.map((x) => x[0])), da: median(cells.map((x) => x[1])), db: median(cells.map((x) => x[2])) };
  const r2 = (v) => Math.round(v * 100) / 100;
  return { ok: true, dL: r2(m.dL), da: r2(m.da), db: r2(m.db), shift: r2(Math.hypot(m.da, m.db)), ...out };
}

// The result with a*/b* moved back by (da, db), written to `outPath` (format by its extension: .png or .jpg).
// Works row band by row band and yields between bands (a 4K picture is ~17 M pixels).
export async function applyColorShift(resultPath, outPath, da, db) {
  const { data, info } = await sharp(resultPath, { limitInputPixels: COLOR_MAX_PIXELS }).rotate().toColourspace('srgb')
    .raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const C = info.channels; // 4: a transparent PNG keeps its alpha unchanged (Codex x70)
  const out = Buffer.allocUnsafe(W * H * C);
  const dfx = -da / 500, dfz = db / 200; // a = 500 (fx − fy), b = 200 (fy − fz); fy (L*) unchanged
  let reduced = 0;
  const lin = [0, 0, 0];
  const toRgb = (fx, fy, fz) => {
    const x = finv(fx) * XN, y = finv(fy), z = finv(fz) * ZN;
    lin[0] = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
    lin[1] = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
    lin[2] = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
    return lin[0] >= -1e-6 && lin[0] <= 1 + 1e-6 && lin[1] >= -1e-6 && lin[1] <= 1 + 1e-6 && lin[2] >= -1e-6 && lin[2] <= 1 + 1e-6;
  };
  const BAND = 64;
  for (let y0 = 0; y0 < H; y0 += BAND) {
    const end = Math.min(H, y0 + BAND) * W * C;
    for (let i = y0 * W * C; i < end; i += C) {
      if (C === 4) out[i + 3] = data[i + 3];
      const r = TO_LIN[data[i]], g = TO_LIN[data[i + 1]], b = TO_LIN[data[i + 2]];
      const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN);
      const fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
      const fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN);
      if (!toRgb(fx + dfx, fy, fz + dfz)) {
        // Outside sRGB: the largest share of the correction that stays inside (bisection).
        let lo = 0, hi = 1;
        for (let k = 0; k < 8; k += 1) { const t = (lo + hi) / 2; if (toRgb(fx + t * dfx, fy, fz + t * dfz)) lo = t; else hi = t; }
        toRgb(fx + lo * dfx, fy, fz + lo * dfz);
        reduced += 1;
      }
      for (let k = 0; k < 3; k += 1) {
        const v = lin[k] <= 0 ? 0 : lin[k] >= 1 ? 1 : lin[k];
        const s = TO_SRGB8[Math.round(v * LUT_N)];
        out[i + k] = s <= 0 ? 0 : s >= 255 ? 255 : Math.round(s);
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  // No metadata: the provider's C2PA manifest would be invalid for changed pixels; lineage is in our record.
  const img = sharp(out, { raw: { width: W, height: H, channels: C }, limitInputPixels: false });
  await (/\.png$/i.test(outPath) || C === 4 ? img.png({ compressionLevel: 6 }) : img.jpeg({ quality: 100, chromaSubsampling: '4:4:4', mozjpeg: false })).toFile(outPath);
  return { width: W, height: H, reducedShare: Math.round((reduced / (W * H)) * 1e5) / 1e5 };
}

// The picture a result was made from: Image to Edit and the Advanced Editor base (attached.edit),
// the editor's source, the canvas extension's source. null for a picture made from nothing.
export function sourceUrlOf(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const u = meta.attached?.edit?.[0]?.url || meta.editor?.source || meta.canvas?.source || null;
  return typeof u === 'string' && /^\/media\/(g|u)\//.test(u) ? u : null;
}

// What the user reads (docs/ux/research/color-fidelity-answers.md): "magenta +2.3, blue +1.8 removed".
export function shiftWords(da, db) {
  const parts = [];
  if (Math.abs(da) >= 0.3) parts.push(`${da > 0 ? 'magenta' : 'green'} +${Math.abs(da).toFixed(1)}`);
  if (Math.abs(db) >= 0.3) parts.push(`${db > 0 ? 'yellow' : 'blue'} +${Math.abs(db).toFixed(1)}`);
  return parts.join(', ') || 'a slight tint';
}

// The derived file's kind: lossless stays lossless.
export const matchedExt = (mime) => (/png|webp|tiff|avif/i.test(String(mime || '')) ? 'png' : 'jpg');
