// Face detection for the shot-size badge (docs/ux/46 §6.4): YuNet 2023mar (OpenCV zoo, MIT,
// assets/models/face_detection_yunet.LICENSE) on the CPU through onnxruntime-web (WebAssembly:
// runs on the Alpine image, no native build). The model takes a fixed 640×640 BGR picture,
// raw 0–255; the frame is scaled to 640 wide and padded below.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'face_detection_yunet_2023mar.onnx');
export const FACE_IN = 640;
let sessionP = null;

async function session() {
  if (!sessionP) {
    sessionP = (async () => {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = 'error';
      return { ort, s: await ort.InferenceSession.create(MODEL) };
    })();
    sessionP.catch(() => { sessionP = null; });
  }
  return sessionP;
}

// rgb: Uint8Array of w×h×3 (w = 640, h ≤ 640). → faces [{ x, y, w, h, score, eyes: [[x,y],[x,y]] }]
// in the rgb picture's pixels, best first, after non-maximum suppression.
export async function detectFaces(rgb, w, h, { minScore = 0.6 } = {}) {
  const { ort, s } = await session();
  const N = FACE_IN;
  const data = new Float32Array(3 * N * N);
  for (let y = 0; y < Math.min(h, N); y += 1) {
    for (let x = 0; x < Math.min(w, N); x += 1) {
      const i = (y * w + x) * 3;
      const o = y * N + x;
      data[o] = rgb[i + 2]; // B
      data[N * N + o] = rgb[i + 1]; // G
      data[2 * N * N + o] = rgb[i]; // R
    }
  }
  const out = await s.run({ input: new ort.Tensor('float32', data, [1, 3, N, N]) });
  const found = [];
  for (const st of [8, 16, 32]) {
    const cls = out[`cls_${st}`].data; const obj = out[`obj_${st}`].data;
    const box = out[`bbox_${st}`].data; const kps = out[`kps_${st}`].data;
    const cols = N / st;
    for (let i = 0; i < cls.length; i += 1) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < minScore) continue;
      const r = Math.floor(i / cols); const c = i % cols;
      const cx = (c + box[i * 4]) * st; const cy = (r + box[i * 4 + 1]) * st;
      const bw = Math.exp(box[i * 4 + 2]) * st; const bh = Math.exp(box[i * 4 + 3]) * st;
      found.push({ x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, score,
        eyes: [[(kps[i * 10] + c) * st, (kps[i * 10 + 1] + r) * st], [(kps[i * 10 + 2] + c) * st, (kps[i * 10 + 3] + r) * st]] });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  const iou = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy; return inter / (a.w * a.h + b.w * b.h - inter);
  };
  for (const f of found) if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  return keep.filter((f) => f.y < h && f.y + f.h > 0);
}
