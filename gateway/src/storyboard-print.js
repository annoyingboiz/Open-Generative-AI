// A storyboard as a page to print or save as PDF (the browser's Print → Save as PDF).
import { esc } from './pages.js';
import { CAMERAS, LENSES, ERAS, LIGHTS, MOVES } from './look.js';

const label = (list, id) => list.find((x) => x.id === id)?.label || '';
const thumb = (url) => (typeof url === 'string' && url.startsWith('/media/') ? `${url}${url.includes('?') ? '&' : '?'}w=960` : '');

export function storyboardPage(sb, { aspect = '16:9' } = {}) {
  const ratio = /^\d{1,2}:\d{1,2}$/.test(String(aspect)) ? String(aspect).replace(':', '/') : '16/9';
  const look = sb.look || {};
  const lookLine = [label(CAMERAS, look.camera), label(LENSES, look.lens), look.focal ? `${look.focal}mm` : '', look.aperture, label(ERAS, look.era), label(LIGHTS, look.light)].filter(Boolean).join(' · ');
  const shots = (sb.shots || []).map((s, i) => {
    const m = sb.media?.[s.id] || {};
    const frame = m.frame ? thumb(m.frame) : '';
    const cam = [label(CAMERAS, s.camera), label(LENSES, s.lens), s.focal ? `${s.focal}mm` : '', s.aperture].filter(Boolean).join(' · ');
    const facts = [s.size, s.angle, label(MOVES, s.move), s.duration ? `${s.duration}s` : ''].filter(Boolean).join(' · ');
    return `<section class="shot">
  <div class="frame">${frame ? `<img src="${esc(frame)}" alt="">` : '<span>No frame yet</span>'}</div>
  <div class="text">
    <h2><b>${i + 1}</b> ${esc(s.title || 'Untitled shot')}</h2>
    ${facts ? `<p class="facts">${esc(facts)}</p>` : ''}
    ${cam ? `<p class="facts">${esc(cam)}</p>` : ''}
    ${s.action ? `<p>${esc(s.action)}</p>` : ''}
    ${s.light ? `<p class="dim">Light: ${esc(s.light)}</p>` : ''}
    ${s.frame_prompt ? `<details><summary>Frame prompt</summary><pre>${esc(s.frame_prompt)}</pre></details>` : ''}
    ${s.motion_prompt ? `<details><summary>Motion prompt</summary><pre>${esc(s.motion_prompt)}</pre></details>` : ''}
  </div>
</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(sb.name || 'Storyboard')}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico?v=1" sizes="32x32"><link rel="icon" href="/dz/brand/favicon.svg?v=1" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=1"><link rel="manifest" href="/manifest.webmanifest?v=1"><meta name="theme-color" content="#0C0C0D">
<style>
  *{box-sizing:border-box} body{margin:0;font:15px/1.45 Inter,system-ui,sans-serif;color:#111;background:#fff}
  header{padding:28px 32px 8px} h1{margin:0 0 6px;font-size:26px} .dim{color:#666} .facts{color:#444;margin:2px 0}
  .bar{display:flex;gap:8px;margin:14px 0 0} button,label{font:inherit;border:1px solid #ccc;border-radius:8px;background:#fff;padding:6px 12px;cursor:pointer}
  main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;padding:16px 32px 40px}
  .shot{break-inside:avoid;border:1px solid #e3e3e3;border-radius:12px;overflow:hidden}
  .frame{background:#f3f3f3;aspect-ratio:${ratio};display:flex;align-items:center;justify-content:center;color:#999}
  .frame img{width:100%;height:100%;object-fit:cover;display:block}
  .text{padding:12px 14px} h2{margin:0 0 6px;font-size:17px} h2 b{display:inline-block;min-width:26px;text-align:center;border-radius:6px;background:#111;color:#fff;margin-right:6px}
  pre{white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;background:#f7f7f7;padding:8px;border-radius:8px} summary{cursor:pointer;color:#444}
  body.prompts details{display:block} body.prompts details>summary{display:none} body.prompts details pre{display:block}
  @media print{.bar{display:none} header{padding:0 0 8px} main{padding:0;gap:12px} body:not(.prompts) details{display:none}}
  @media (max-width:760px){main{grid-template-columns:1fr}}
</style></head><body>
<header>
  <h1>${esc(sb.name || 'Storyboard')}</h1>
  ${sb.scene ? `<p>${esc(sb.scene)}</p>` : ''}
  ${lookLine || look.note ? `<p class="dim">${esc([lookLine, look.note].filter(Boolean).join(' — '))}</p>` : ''}
  <p class="dim">${(sb.shots || []).length} shots</p>
  <div class="bar"><button type="button" onclick="window.print()">Print / Save as PDF</button>
  <label><input type="checkbox" onchange="document.body.classList.toggle('prompts', this.checked);document.querySelectorAll('details').forEach(d=>d.open=this.checked)"> Include prompts</label></div>
</header>
<main>
${shots}
</main></body></html>`;
}
