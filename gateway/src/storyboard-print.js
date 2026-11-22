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
  // Sheets (package 14, A2): the page lays itself out in A4 sheets of its own, each with a footer
  // line (the mark and "Director" on the left, "Page N of M" on the right). The browser's own
  // page boxes can't do this outside Chrome, so the sheets are made here, once the fonts are in,
  // and again when "Include prompts" changes their height.
  const mark = '<svg viewBox="0 0 64 64" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 28h40v18a10 10 0 0 1-10 10H22a10 10 0 0 1-10-10z"/><path transform="rotate(-16 12 27)" d="M12 17h41v10H44l5-6h-9l-5 6h-4l5-6h-9l-5 6H12z"/></svg>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(sb.name || 'Storyboard')}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico?v=1" sizes="32x32"><link rel="icon" href="/dz/brand/favicon.svg?v=1" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=1"><link rel="manifest" href="/manifest.webmanifest?v=1"><meta name="theme-color" content="#0C0C0D">
<style>
  @page{size:A4 portrait;margin:12mm}
  *{box-sizing:border-box} body{margin:0;font:15px/1.45 Inter,system-ui,sans-serif;color:#111;background:#3a3a3c}
  header{padding:0 0 8px} h1{margin:0 0 6px;font-size:26px} .dim{color:#666} .facts{color:#444;margin:2px 0}
  .bar{position:sticky;top:0;z-index:2;display:flex;justify-content:center;gap:8px;padding:12px;background:#3a3a3c}
  .bar button,.bar label{font:inherit;border:1px solid #ccc;border-radius:8px;background:#fff;padding:6px 12px;cursor:pointer}
  .sheet{width:186mm;height:265mm;margin:16px auto;padding:12mm;box-sizing:content-box;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
  .grid{flex-shrink:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-content:start} .sheet>header{flex-shrink:0}
  .fill{flex:1}
  .shot{break-inside:avoid;border:1px solid #e3e3e3;border-radius:12px;overflow:hidden}
  .frame{background:#f3f3f3;aspect-ratio:${ratio};display:flex;align-items:center;justify-content:center;color:#999}
  .frame img{width:100%;height:100%;object-fit:cover;display:block}
  .text{padding:12px 14px} h2{margin:0 0 6px;font-size:17px} h2 b{display:inline-block;min-width:26px;text-align:center;border-radius:6px;background:#111;color:#fff;margin-right:6px}
  pre{white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;background:#f7f7f7;padding:8px;border-radius:8px} summary{cursor:pointer;color:#444}
  body.prompts details{display:block} body.prompts details>summary{display:none} body.prompts details pre{display:block}
  footer.page{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid #e3e3e3;font-size:10px;line-height:1;color:#8a8a8a}
  footer.page .brand{display:flex;align-items:center;gap:5px;color:#111;font-weight:600}
  .sheet.tall{height:auto;min-height:265mm;overflow:visible}
  #src{position:absolute;left:-10000px;top:0;width:186mm}
  @media print{body{background:#fff}.bar{display:none}.sheet{margin:0;padding:0;box-shadow:none;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto} .sheet.tall .shot{break-inside:auto} body:not(.prompts) details{display:none}}
</style></head><body>
<div class="bar"><button type="button" onclick="window.print()">Print / Save as PDF</button>
<label><input type="checkbox" onchange="document.body.classList.toggle('prompts', this.checked);document.querySelectorAll('details').forEach(d=>d.open=this.checked);dzSheets()"> Include prompts</label></div>
<div id="src">
<header>
  <h1>${esc(sb.name || 'Storyboard')}</h1>
  ${sb.scene ? `<p>${esc(sb.scene)}</p>` : ''}
  ${lookLine || look.note ? `<p class="dim">${esc([lookLine, look.note].filter(Boolean).join(' — '))}</p>` : ''}
  <p class="dim">${(sb.shots || []).length} shots</p>
</header>
${shots}
</div>
<div id="sheets"></div>
<template id="foot"><footer class="page"><span class="brand">${mark}Director</span><span class="n"></span></footer></template>
<script>
function dzSheets(){
  var src=document.getElementById('src'),out=document.getElementById('sheets'),foot=document.getElementById('foot');
  // Back to one list, then into sheets: a card that does not fit starts the next sheet.
  Array.prototype.slice.call(out.querySelectorAll('header,.shot')).forEach(function(n){src.appendChild(n);});
  out.innerHTML='';
  var sheets=[],sheet,grid;
  function next(){sheet=document.createElement('section');sheet.className='sheet';grid=document.createElement('div');grid.className='grid';
    sheet.appendChild(grid);var fill=document.createElement('div');fill.className='fill';sheet.appendChild(fill);sheet.appendChild(foot.content.cloneNode(true));out.appendChild(sheet);sheets.push(sheet);}
  function over(){var f=sheet.querySelector('footer.page');return f.getBoundingClientRect().bottom>sheet.getBoundingClientRect().bottom-parseFloat(getComputedStyle(sheet).paddingBottom)+0.5;}
  // One card (or the film's header) taller than a sheet is not cut: that sheet grows and runs
  // over as many printed pages as it needs; the next card starts a new sheet.
  function tall(){sheet.classList.add('tall');}
  next();
  var full=sheet.getBoundingClientRect().height;
  var head=src.querySelector('header');if(head){sheet.insertBefore(head,grid);if(over())tall();}
  Array.prototype.slice.call(src.querySelectorAll('.shot')).forEach(function(card){
    if(sheet.classList.contains('tall'))next();
    grid.appendChild(card);
    if(!over())return;
    if(grid.children.length>1||sheet.querySelector('header')){next();grid.appendChild(card);}
    if(over())tall();
  });
  var total=0,pages=sheets.map(function(s){var n=s.classList.contains('tall')?Math.max(1,Math.ceil(s.getBoundingClientRect().height/full-0.01)):1;total+=n;return n;});
  var at=0;sheets.forEach(function(s,i){at+=pages[i];s.querySelector('footer.page .n').textContent='Page '+at+' of '+total;});
}
(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(dzSheets);
window.addEventListener('beforeprint',dzSheets);
</script>
</body></html>`;
}
