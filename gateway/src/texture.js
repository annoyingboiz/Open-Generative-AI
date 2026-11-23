// Texture filter (handoff 17, §6): film and video texture added on this server after
// a video is made — grain, noise, softness, gate weave, flicker, dust and scratches,
// chroma bleed, scan lines. Video models smooth grain away and turn drawn dust into
// real objects, so the texture never comes from the prompt.
//
// The clean original is always kept; the filtered copy is made from it. Strength
// 0–100 (default 60) scales every effect linearly: 60 is the tuned preset.
// Audio is copied unchanged.

import { spawn } from 'node:child_process';

export const TEXTURE_PRESETS = ['35mm', '16mm', '8mm', 'dv', 'vhs'];
export const TEXTURE_DEFAULT = 60;

const r2 = (x) => Math.round(x * 100) / 100;
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

// Effects that move with time use the frame number n (expressions are evaluated per frame).
// "Random" weave: two sines of unrelated speeds, steady enough to read as a film gate.
const weave = (px, w, h) => (px < 0.5 ? [] : [
  `crop=w=${w - 2 * Math.ceil(px)}:h=${h - 2 * Math.ceil(px)}:x='${Math.ceil(px)}+${r2(px)}*sin(n*1.7)*cos(n*0.23)':y='${Math.ceil(px)}+${r2(px * 0.6)}*sin(n*1.3+1)'`,
  `scale=${w}:${h}:flags=bicubic`,
]);
// Soft: down to a share of the size and back (a lower-resolution film or tape).
const soften = (share, w, h) => (share >= 0.98 ? [] : [`scale=${even(w * share)}:${even(h * share)}:flags=area`, `scale=${w}:${h}:flags=bicubic`]);

// → { graph, out } for -filter_complex (input [0:v]); null when nothing is applied.
// info: { width, height, fps } of the clean video.
export function textureGraph(preset, strength, info) {
  const s = Math.max(0, Math.min(100, Number(strength))) / TEXTURE_DEFAULT; // 1 = the tuned preset
  if (!TEXTURE_PRESETS.includes(preset) || !(s > 0) || !info?.width || !info?.height) return null;
  const w = even(info.width);
  const h = even(info.height);
  const fps = Number(info.fps) > 0 ? Number(info.fps) : 24;
  const k = Math.min(w, h) / 720; // pixel effects scale with the picture (tuned at 720p)
  const chains = [];
  let main = [`scale=${w}:${h}`, 'format=yuv420p'];

  if (preset === '35mm') {
    // Fine moving grain, a slight warm halation around highlights; no resolution loss.
    // The glow is mixed in RGB (in YUV a screen blend tints everything magenta).
    chains.push(`[0:v]${main.join(',')},format=gbrp,split[a][b]`);
    chains.push(`[b]curves=all='0/0 0.72/0 1/1',gblur=sigma=${r2(10 * k)},colorchannelmixer=rr=1:gg=0.55:bb=0.35[glow]`);
    chains.push(`[a][glow]blend=all_mode=screen:all_opacity=${r2(Math.min(0.4, 0.14 * s))},format=yuv420p,noise=c0s=${r2(9 * s)}:c0f=t+u:c1s=${r2(3 * s)}:c1f=t+u:c2s=${r2(3 * s)}:c2f=t+u[out]`);
    return { graph: chains.join(';'), out: '[out]' };
  }
  if (preset === '16mm') {
    // Coarse moving grain, slightly soft, lifted blacks, a mild gate weave.
    main = [...main, ...soften(1 - 0.25 * Math.min(s, 1.6), w, h), `curves=all='0/${r2(Math.min(0.15, 0.06 * s))} 1/1'`, `noise=c0s=${r2(18 * s)}:c0f=t+u:c1s=${r2(5 * s)}:c1f=t+u:c2s=${r2(5 * s)}:c2f=t+u`, ...weave(1 * s * k, w, h)];
    chains.push(`[0:v]${main.join(',')}[out]`);
    return { graph: chains.join(';'), out: '[out]' };
  }
  if (preset === '8mm') {
    // Very coarse grain, soft, strong vignette, flicker, gate weave, 18 fps feel,
    // moving dust and scratches (made here, new every frame — never in the picture model).
    main = [...main, `fps=18`, ...soften(1 - 0.45 * Math.min(s, 1.5), w, h),
      `noise=c0s=${r2(24 * s)}:c0f=t+u:c1s=${r2(8 * s)}:c1f=t+u:c2s=${r2(8 * s)}:c2f=t+u`,
      `vignette=angle=${r2(Math.min(1.2, (Math.PI / 4) * Math.min(s, 1.5)))}`,
      `eq=brightness='${r2(0.035 * s)}*(random(1)*2-1)':eval=frame`,
      ...weave(2 * s * k, w, h)];
    chains.push(`[0:v]${main.join(',')}[pic]`);
    // Dust: rare specks a few pixels wide; scratches: thin vertical lines that jump.
    // New on every frame (random per pixel), so nothing stays in place to read as an object.
    const dw = even(w / 6);
    const dh = even(h / 6);
    chains.push(`color=c=black:s=${dw}x${dh}:r=18,format=gray,geq=lum='if(lt(random(1),${(0.0005 * s).toFixed(5)}),255,0)',scale=${w}:${h}:flags=bilinear,gblur=sigma=${r2(1.1 * k)}[dust]`);
    chains.push(`color=c=black:s=${w}x1:r=18,format=gray,geq=lum='if(lt(random(1),${(0.0009 * s).toFixed(5)}),${Math.round(Math.min(255, 120 * s))},0)',scale=${w}:${h}:flags=neighbor,gblur=sigma=0.7[scr]`);
    chains.push(`[dust][scr]blend=all_mode=lighten:shortest=1,format=yuv420p[dirt]`);
    // Brightness only: the colour planes keep the picture (opacity 0 there).
    chains.push(`[pic][dirt]blend=all_mode=screen:shortest=1:c0_opacity=${r2(Math.min(1, 0.85 * s))}:c1_opacity=0:c2_opacity=0,fps=${fps}[out]`);
    return { graph: chains.join(';'), out: '[out]' };
  }
  if (preset === 'dv') {
    // Standard-definition softness with sharpening halos, 4:1:1 chroma, video noise.
    const sd = Math.min(1, Math.min(720 / w, 480 / h));
    const share = 1 - (1 - sd) * Math.min(1, s);
    main = [...main, ...(share < 0.98 ? [`scale=${even(w * share)}:${even(h * share)}:flags=area`, 'format=yuv411p', 'format=yuv420p', `scale=${w}:${h}:flags=bicubic`] : ['format=yuv411p', 'format=yuv420p']),
      `unsharp=5:5:${r2(1.6 * Math.min(s, 1.6))}:5:5:0`,
      `noise=c0s=${r2(8 * s)}:c0f=t:c1s=${r2(3 * s)}:c1f=t:c2s=${r2(3 * s)}:c2f=t`];
    chains.push(`[0:v]${main.join(',')}[out]`);
    return { graph: chains.join(';'), out: '[out]' };
  }
  // VHS: low horizontal resolution, chroma bleeding right, luma noise, faint scan lines,
  // a tracking band now and then, head-switching noise at the bottom.
  const lines = even(Math.max(240, w * (1 - (1 - 330 / 1280) * Math.min(s, 1.3))));
  main = [...main, `scale=${lines}:${h}:flags=area`, 'format=yuv410p', 'format=yuv420p', `scale=${w}:${h}:flags=bicubic`,
    `chromashift=cbh=${Math.round(4 * s * k)}:crh=${Math.round(4 * s * k)}`,
    `noise=c0s=${r2(12 * s)}:c0f=t:c1s=${r2(4 * s)}:c1f=t:c2s=${r2(4 * s)}:c2f=t`,
    `drawgrid=w=iw:h=${Math.max(2, Math.round(3 * k))}:t=1:c=black@${r2(Math.min(0.3, 0.09 * s))}`];
  chains.push(`[0:v]${main.join(',')}[pic]`);
  const band = even(h / 14);
  const strip = even(Math.max(6, 7 * k));
  chains.push(`color=c=gray:s=${w}x${band}:r=${fps},noise=c0s=90:c0f=t+u:c1s=30:c1f=t,format=yuva420p,colorchannelmixer=aa=${r2(Math.min(0.9, 0.45 * s))}[band]`);
  chains.push(`color=c=black:s=${w}x${strip}:r=${fps},noise=c0s=100:c0f=t+u:c1s=40:c1f=t,format=yuva420p,colorchannelmixer=aa=${r2(Math.min(1, 0.8 * s))}[head]`);
  chains.push(`[pic][band]overlay=x=0:y='mod(t*${Math.round(h / 3)},${h})':eval=frame:shortest=1:enable='lt(mod(t,4.7),0.45)'[pb]`);
  chains.push(`[pb][head]overlay=x=0:y=${h - strip}:shortest=1[out]`);
  return { graph: chains.join(';'), out: '[out]' };
}

function run(bin, args, { timeoutMs = 10 * 60_000, nice = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', String(nice), bin, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stderr.on('data', (c) => { if (err.length < 4000) err += c; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(err.trim().slice(-400) || `${bin} exit ${code}`)); });
  });
}

// clean → dst with the preset at this strength. info: { width, height, fps, audio }.
export async function applyTexture(clean, dst, preset, strength, info, { ffmpegPath = 'ffmpeg' } = {}) {
  const g = textureGraph(preset, strength, info);
  if (!g) throw new Error('Nothing to apply.');
  await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', clean, '-filter_complex', g.graph, '-map', g.out, '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '4', '-c:a', 'copy', '-movflags', '+faststart', dst]);
}
