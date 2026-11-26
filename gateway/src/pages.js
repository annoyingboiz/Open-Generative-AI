// Server-rendered pages of the gateway: sign-in, first-run setup, settings.
// Plain HTML + a little CSS in the studio's dark style; no client framework.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const CSS = `
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/dz/fonts/inter-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/dz/fonts/inter-cyrillic.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
:root{--bg:#030303;--panel:#0a0a0b;--line:rgba(255,255,255,.08);--text:#f4f4f5;--muted:rgba(255,255,255,.5);--accent:#22d3ee;--danger:#f87171;--ok:#4ade80}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.center{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:380px}
.wide{max-width:880px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:0 0 12px}p.sub{color:var(--muted);margin:0 0 20px}
label{display:block;font-size:16px;font-weight:600;color:var(--muted);margin:12px 0 6px}
textarea{width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit;font-size:16px}
input,select{width:100%;height:44px;padding:0 12px;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit}
input:focus,select:focus{outline:none;border-color:var(--accent)}
input[type=checkbox]{width:auto;height:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 18px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#000}.btn.danger{color:var(--danger)}.btn.small{height:36px;padding:0 12px;font-size:16px}
.full{width:100%;margin-top:20px}
.msg{padding:10px 12px;border-radius:8px;margin:0 0 16px;border:1px solid var(--line)}.msg.err{color:var(--danger);border-color:rgba(248,113,113,.3)}.msg.ok{color:var(--ok);border-color:rgba(74,222,128,.3)}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}
.section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.grid2{grid-template-columns:1fr}}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.secret{-webkit-text-security:disc;text-security:disc}.muted{color:var(--muted)}.mono{font-family:ui-monospace,Menlo,monospace}
table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{font-size:16px;color:var(--muted);font-weight:600}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:16px;border:1px solid var(--line)}.pill.ok{color:var(--ok)}.pill.err{color:var(--danger)}
details summary{cursor:pointer;color:var(--accent)}
/* Sign in and first run (package 14, A1): the app's dark tokens, the mark and the word above the card. */
body.auth-page{background:hsl(240 4% 5%)}
.auth{--a-bg:hsl(240 4% 5%);--a-card:hsl(240 2% 8%);--a-border:hsl(240 3% 17%);--a-input:hsl(240 2% 43%);--a-fg:hsl(60 7% 95%);--a-muted:hsl(60 3% 63%);--a-primary:hsl(60 7% 95%);--a-primary-fg:hsl(240 4% 5%);--a-primary-hover:hsl(60 4% 85%);background:var(--a-bg);color:var(--a-fg);flex-direction:column;gap:20px}
.auth .brand{display:flex;align-items:center;justify-content:center;gap:10px;font-size:22px;font-weight:600;line-height:1;color:var(--a-fg)}
.auth .brand svg{width:32px;height:32px;flex-shrink:0}
.auth .card{background:var(--a-card);border-color:var(--a-border);border-radius:12px;padding:28px}
.auth h1{font-size:20px;font-weight:600;margin:0 0 20px}.auth p.sub{color:var(--a-muted);font-size:14px;margin:-12px 0 16px}
.auth label{font-size:14px;font-weight:400;color:var(--a-muted);margin:14px 0 6px}
.auth input{height:40px;background:transparent;border-color:var(--a-input);color:var(--a-fg)}.auth input:focus{border-color:var(--a-fg)}
.auth .btn.primary{height:40px;background:var(--a-primary);border-color:var(--a-primary);color:var(--a-primary-fg);font-weight:500;font-size:15px;border-radius:8px}.auth .btn.primary:hover{background:var(--a-primary-hover)}
`;
// The Director mark (package 11, docs/ux/handoff/11-logo/assets/director-mark.svg), in the text colour.
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 28h40v18a10 10 0 0 1-10 10H22a10 10 0 0 1-10-10z"/><path transform="rotate(-16 12 27)" d="M12 17h41v10H44l5-6h-9l-5 6h-4l5-6h-9l-5 6H12z"/></svg>';
const BRAND = `<div class="brand">${MARK}<span>Director</span></div>`;

function layout(title, body, bodyClass = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="icon" href="/favicon.ico?v=1" sizes="32x32"><link rel="icon" href="/dz/brand/favicon.svg?v=1" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=1"><link rel="manifest" href="/manifest.webmanifest?v=1"><meta name="theme-color" content="#0C0C0D"><style>${CSS}</style></head><body${bodyClass ? ` class="${bodyClass}-page"` : ''}>${body}</body></html>`;
}

const flash = (error, notice) => `${error ? `<div class="msg err">${esc(error)}</div>` : ''}${notice ? `<div class="msg ok">${esc(notice)}</div>` : ''}`;

export function loginPage({ error, next = '/library/studio', username = '' } = {}) {
  return layout('Sign in · Director', `<div class="center auth">${BRAND}<form class="card" method="post" action="/login">
<h1>Sign in to Director</h1>${flash(error)}
<input type="hidden" name="next" value="${esc(next)}">
<label for="u">Login</label><input id="u" name="username" autocomplete="username" value="${esc(username)}" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button class="btn primary full" type="submit">Sign in</button></form></div>`, 'auth');
}

export function setupPage({ error, values = {} } = {}) {
  return layout('First start · Director', `<div class="center auth">${BRAND}<form class="card" method="post" action="/setup">
<h1>First start</h1><p class="sub">Create the admin account. Only the admin sees provider keys and creates accounts for others.</p>${flash(error)}
<label for="c">Setup code (from the server log or DATA_DIR/setup-code)</label><input id="c" name="setupCode" autocomplete="off" required value="${esc(values.setupCode)}">
<label for="d">Your name</label><input id="d" name="displayName" value="${esc(values.displayName)}" required autofocus>
<label for="u">Login</label><input id="u" name="username" autocomplete="username" value="${esc(values.username)}" required>
<label for="p">Password (8+ characters)</label><input id="p" name="password" type="password" autocomplete="new-password" required minlength="8">
<button class="btn primary full" type="submit">Create admin</button></form></div>
<script>/* The installer opens /setup#code=…: fill it in, then drop it from the address (a fragment never reaches the server). */
(function(){var m=/^#code=([A-Za-z0-9_-]{6,40})$/.exec(location.hash);if(m){var c=document.getElementById('c');if(c&&!c.value)c.value=m[1];history.replaceState(null,'',location.pathname);}})();</script>`, 'auth');
}
