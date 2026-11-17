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
`;

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

const flash = (error, notice) => `${error ? `<div class="msg err">${esc(error)}</div>` : ''}${notice ? `<div class="msg ok">${esc(notice)}</div>` : ''}`;

export function loginPage({ error, next = '/studio', username = '' } = {}) {
  return layout('Sign in', `<div class="center"><form class="card" method="post" action="/login">
<h1>Sign in</h1><p class="sub">AI Video Platform</p>${flash(error)}
<input type="hidden" name="next" value="${esc(next)}">
<label for="u">Login</label><input id="u" name="username" autocomplete="username" value="${esc(username)}" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button class="btn primary full" type="submit">Sign in</button></form></div>`);
}

export function setupPage({ error, values = {} } = {}) {
  return layout('First start', `<div class="center"><form class="card" method="post" action="/setup">
<h1>First start</h1><p class="sub">Create the admin account. Only the admin sees provider keys and creates accounts for others.</p>${flash(error)}
<label for="c">Setup code (from the server log or DATA_DIR/setup-code)</label><input id="c" name="setupCode" autocomplete="off" required>
<label for="d">Your name</label><input id="d" name="displayName" value="${esc(values.displayName)}" required autofocus>
<label for="u">Login</label><input id="u" name="username" autocomplete="username" value="${esc(values.username)}" required>
<label for="p">Password (8+ characters)</label><input id="p" name="password" type="password" autocomplete="new-password" required minlength="8">
<button class="btn primary full" type="submit">Create admin</button></form></div>`);
}

function balanceCell(b) {
  if (!b) return '';
  if (b.ok && b.amount == null) return `<span class="pill ok">key works</span> <span class="muted">${esc(b.note || '')}</span>`;
  if (b.ok) return `<span class="pill ok">$${Number(b.amount).toFixed(2)}</span>`;
  if (!b.hasKey) return '<span class="muted">no key</span>';
  if (!b.enabled) return '<span class="muted">off</span>';
  return `<span class="pill err" title="${esc(b.error)}">error</span> <span class="muted">${esc(b.error)}</span>`;
}

export function settingsPage({ user, providers = [], balances = [], users = [], recommended = [], families = [], changes = null, error, notice }) {
  const isAdmin = user.role === 'admin';
  const balanceById = Object.fromEntries(balances.map((b) => [b.id, b]));

  const providerSections = providers.map((p) => `
<form class="section" id="provider-${esc(p.id)}" method="post" action="/dz/settings/providers/${esc(p.id)}" autocomplete="off">
  <div class="top" style="margin-bottom:8px"><h2 style="margin:0">${esc(p.name)}</h2><div>${balanceCell(balanceById[p.id])}</div></div>
  <div class="grid2">
    <div><label>API key ${p.hasKey ? `<span class="mono">${esc(p.keyMask)}</span> <span class="muted">(${p.keySource === 'env' ? 'from .env' : 'saved'})</span>` : '<span class="muted">— not set</span>'}</label>
      <input name="apiKey" type="text" class="secret" autocomplete="off" spellcheck="false" autocapitalize="off" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" placeholder="${p.hasKey ? 'Leave empty to keep the current key' : 'Paste the key'}">
      ${p.keysUrl ? `<div class="muted" style="font-size:16px;margin-top:4px">Get a key: <a href="${esc(p.keysUrl)}" target="_blank" rel="noreferrer">${esc(p.keysUrl)}</a></div>` : ''}</div>
    <div><label>Proxy (optional)</label>
      <input name="proxy" value="${esc(p.proxy)}" placeholder="socks5h://127.0.0.1:1080" autocomplete="off">
      <div class="muted" style="font-size:16px;margin-top:4px">All requests to ${esc(p.name)} go through it, incl. downloads. Empty = direct.</div></div>
  </div>
  <div class="row" style="margin-top:14px">
    <label class="row" style="margin:0;color:var(--text)"><input type="checkbox" name="enabled" value="1" ${p.enabled ? 'checked' : ''}> Enabled</label>
    <span style="flex:1"></span>
    ${p.keySource === 'settings' ? '<label class="row" style="margin:0"><input type="checkbox" name="clearKey" value="1"> Remove saved key</label>' : ''}
    <button class="btn primary small" type="submit">Save &amp; check</button>
  </div>
</form>`).join('');

  const userRows = users.map((u) => `
<tr>
  <td><b>${esc(u.display_name)}</b><div class="muted mono" style="font-size:16px">${esc(u.username)}</div></td>
  <td colspan="4">
    <form class="row" method="post" action="/dz/settings/users/${u.id}">
      <select name="role" style="width:auto">${['user', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <input name="monthlyLimitUsd" type="number" min="0" step="0.5" style="width:120px" placeholder="no limit" value="${u.monthly_limit_usd ?? ''}" title="Monthly spending limit, USD">
      <label class="row" style="margin:0;color:var(--text)"><input type="checkbox" name="disabled" value="1" ${u.disabled ? 'checked' : ''}> blocked</label>
      <input name="newPassword" type="password" autocomplete="new-password" style="width:160px" placeholder="new password">
      <button class="btn small" type="submit">Save</button>
    </form>
  </td>
</tr>`).join('');

  const adminBlocks = isAdmin ? `
<h2 style="margin:28px 0 12px">Providers</h2>
<p class="muted" style="margin-top:-6px">Keys are stored encrypted on this server and never sent to the browser.</p>
${providerSections}
<h2 style="margin:28px 0 12px" id="changes">Provider changes</h2>
${changes ? changesSection(changes) : ''}
<h2 style="margin:28px 0 12px" id="recommended">Recommended models</h2>
${recommendedSection(recommended, families)}
<h2 style="margin:28px 0 12px">Test generation</h2>
<form class="section" method="post" action="/dz/settings/test-generation">
  <p class="muted" style="margin-top:0">One cheap picture to check that a provider works end to end: request → server waits → file saved on this server. Costs real money (about $0.01).</p>
  <label>Prompt</label><input name="prompt" value="A red paper boat on a calm lake at sunrise, photo">
  <div class="row" style="margin-top:14px">
    <button class="btn" name="provider" value="apimart" type="submit">APIMart · Z-Image Turbo (~$0.01)</button>
    <button class="btn" name="provider" value="atlas" type="submit">Atlas · FLUX.1 schnell (~$0.003)</button>
  </div>
</form>
<h2 style="margin:28px 0 12px">Accounts</h2>
<div class="section">
  <table><thead><tr><th>Person</th><th colspan="4">Role · monthly limit (USD) · status · password reset</th></tr></thead><tbody>${userRows}</tbody></table>
  <details style="margin-top:16px"><summary>Add an account</summary>
    <form method="post" action="/dz/settings/users" class="grid2" style="margin-top:8px">
      <div><label>Name</label><input name="displayName" required></div>
      <div><label>Login</label><input name="username" required autocomplete="off"></div>
      <div><label>Password (8+)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
      <div><label>Monthly limit, USD (empty = none)</label><input name="monthlyLimitUsd" type="number" min="0" step="0.5"></div>
      <div><label>Role</label><select name="role"><option value="user">user</option><option value="admin">admin</option></select></div>
      <div style="display:flex;align-items:flex-end"><button class="btn primary" type="submit">Create account</button></div>
    </form>
  </details>
</div>` : '';

  return layout('Settings', `<div class="wide">
<div class="top"><div><h1>Settings</h1><div class="muted">Signed in as <b>${esc(user.display_name)}</b> (${esc(user.username)}, ${esc(user.role)})</div></div>
<div class="row"><a class="btn" href="/studio">← Back to studio</a><form method="post" action="/logout"><button class="btn danger" type="submit">Sign out</button></form></div></div>
${flash(error, notice)}
<div class="section"><h2>My password</h2>
<form method="post" action="/dz/settings/password" class="grid2">
  <div><label>Current password</label><input name="currentPassword" type="password" required autocomplete="current-password"></div>
  <div><label>New password (8+)</label><input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></div>
  <div><button class="btn" type="submit">Change password</button></div>
</form></div>
${adminBlocks}
</div>`);
}

const CHANGE_LABEL = {
  'model-added': 'New model', 'model-removed': 'Model removed', 'model-missing': 'Not in the docs',
  'param-added': 'New setting', 'param-removed': 'Setting removed', 'param-changed': 'Setting changed',
  'values-added': 'New values', 'values-removed': 'Values removed', 'range-changed': 'Range changed',
  'limit-changed': 'File limit changed', 'default-changed': 'Default changed', 'price-changed': 'Price changed',
  'mode-added': 'New mode', 'mode-removed': 'Mode removed', 'rename-changed': 'Field names changed',
  rejected: 'Request refused', 'check-skipped': 'Check skipped',
};
const STATUS_LABEL = { applied: 'live', review: 'needs review', info: 'info', resolved: 'resolved', replaced: 'replaced', dismissed: 'kept old', closed: 'closed' };
const STATUS_COLOR = { applied: 'var(--ok, #4ade80)', review: '#fbbf24', info: 'var(--muted, #888)' };

function changesSection({ entries, summary, telegram }) {
  const when = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  const form = (action, field, value, label, cls = '') => `<form method="post" action="/dz/settings/changes/${action}" style="display:inline"><input type="hidden" name="${field}" value="${esc(value)}"><button class="btn small ${cls}" type="submit">${label}</button></form>`;
  const shownModels = new Set();
  const rows = entries.map((e) => {
    let actions = '';
    if (e.status === 'review' && e.source === 'docs' && e.model && !shownModels.has(e.model)) {
      shownModels.add(e.model);
      actions = `${form('apply', 'model', e.model, 'Use the docs version', 'primary')} ${form('dismiss', 'model', e.model, 'Keep current')}`;
    } else if (e.status === 'review' && e.source !== 'docs') {
      actions = form('close', 'id', e.id, 'Done');
    }
    const what = [e.mode, e.param].filter(Boolean).join(' · ');
    return `<tr${e.seen ? '' : ' style="background:rgba(34,211,238,.06)"'}>
  <td class="muted mono" style="white-space:nowrap">${esc(when(e.at))}</td>
  <td>${esc(e.provider)}<div class="muted" style="font-size:16px">${esc(e.source)}</div></td>
  <td><b>${esc(e.name || e.model || e.endpoint || '')}</b>${what ? `<div class="muted mono" style="font-size:16px">${esc(what)}</div>` : ''}</td>
  <td>${esc(CHANGE_LABEL[e.type] || e.type)}<div class="muted" style="font-size:16px;max-width:420px;overflow-wrap:anywhere">${esc(String(e.detail || '').slice(0, 300))}</div></td>
  <td style="white-space:nowrap;color:${STATUS_COLOR[e.status] || 'inherit'}">${esc(STATUS_LABEL[e.status] || e.status)}</td>
  <td style="text-align:right;white-space:nowrap">${actions}</td>
</tr>`;
  }).join('');
  const last = summary.lastCheck ? when(summary.lastCheck) : 'not yet';
  return `<div class="section">
  <p class="muted" style="margin-top:0">Checked every day. <b>Atlas</b> publishes machine-readable schemas: new settings appear in the studio by themselves, and this list says what changed. <b>APIMart</b> settings come from its docs: new values or wider limits are applied by themselves, anything else waits for you here. Requests a provider refuses are listed too — usually a sign its spec changed.</p>
  <div class="row" style="margin-bottom:12px">
    <span><b>${summary.review}</b> need review · APIMart docs last checked: ${esc(last)}${telegram ? ' · Telegram alerts on' : ' · Telegram alerts off (set DZ_TELEGRAM_BOT_TOKEN and DZ_TELEGRAM_CHAT_ID)'}</span>
    <span style="flex:1"></span>
    <form method="post" action="/dz/settings/changes/check"><button class="btn small" type="submit">Check now</button></form>
  </div>
  <div style="max-height:520px;overflow:auto"><table><thead><tr><th>When (UTC)</th><th>Provider</th><th>Model</th><th>Change</th><th>Status</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" class="muted">No changes yet. The first check only remembers how things are now.</td></tr>'}</tbody></table></div>
</div>`;
}

function recommendedSection(recommended, families) {
  const byKey = new Map(families.map((f) => [f.key, f]));
  const button = (action, key, label, cls = '') => `<form method="post" action="/dz/settings/recommended" style="display:inline"><input type="hidden" name="action" value="${action}"><input type="hidden" name="key" value="${esc(key)}"><button class="btn small ${cls}" type="submit">${label}</button></form>`;
  const rows = recommended.map((key, i) => {
    const f = byKey.get(key);
    return `<tr><td class="muted">${i + 1}</td><td><b>${esc(f?.name || key)}</b> <span class="muted">${f ? esc(f.kind) : '— not in the catalog now'}</span></td><td style="text-align:right">${i > 0 ? button('up', key, '↑') : ''} ${button('remove', key, 'Remove', 'danger')}</td></tr>`;
  }).join('');
  const options = (kind) => families.filter((f) => f.kind === kind && !recommended.includes(f.key))
    .map((f) => `<option value="${esc(f.key)}">${esc(f.name)}</option>`).join('');
  return `<div class="section">
  <p class="muted" style="margin-top:0">These families are shown first in the model lists (images and video), in this order. Inside a family the cheapest provider stays the default.</p>
  <table><tbody>${rows || '<tr><td class="muted">None — lists use the catalog order.</td></tr>'}</tbody></table>
  <form method="post" action="/dz/settings/recommended" class="row" style="margin-top:14px">
    <input type="hidden" name="action" value="add">
    <select name="key" style="flex:1"><optgroup label="Images">${options('image')}</optgroup><optgroup label="Video">${options('video')}</optgroup></select>
    <button class="btn small primary" type="submit">Add</button>
  </form>
  <div style="margin-top:10px">${button('reset', '', 'Reset to defaults')}</div>
</div>`;
}

export function testResultPage({ result, provider, model }) {
  const done = result.status === 'completed' || result.status === 'failed';
  const body = result.status === 'completed'
    ? `<div class="msg ok">Done. The file is stored on this server.</div><img src="${esc(result.url)}" style="max-width:100%;border-radius:12px;border:1px solid var(--line)"><p class="muted mono" style="font-size:16px">${esc(result.url)}${result.cost != null ? ` · cost $${esc(result.cost)}` : ''}</p>`
    : result.status === 'failed'
      ? `<div class="msg err">Failed: ${esc(result.error)}</div>`
      : '<p>Waiting for the provider… this page refreshes itself.</p>';
  return layout('Test generation', `${done ? '' : '<meta http-equiv="refresh" content="3">'}<div class="wide"><div class="top"><h1>Test generation · ${esc(provider)} · <span class="mono">${esc(model)}</span></h1><a class="btn" href="/dz/settings">← Settings</a></div>${body}</div>`);
}
