// Provider changes: what changed in the provider catalogs and in APIMart's
// docs since the last check, kept as a journal for the admin.
//
//   DATA_DIR/catalog/changes.json           journal (newest first, capped)
//   DATA_DIR/catalog/snapshot-<prov>.json   last seen catalog per provider
//   DATA_DIR/catalog/apimart-live.json      APIMart specs applied from the docs
//   DATA_DIR/catalog/apimart-previous.json  the spec before each automatic change
//   DATA_DIR/catalog/apimart-refused.json   docs versions that broke requests
//
// Everything is automatic. Atlas describes its models in machine-readable
// schemas and the studio draws itself from them, so its changes are live at
// once. APIMart's settings come from its docs: every change is applied. If the
// provider then refuses requests over a setting, the change is undone by
// itself. The journal says what happened.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 500;
const DAY = 86_400_000;

function writeJsonAtomic(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const sorted = (list) => [...list].map(String).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Comparing one model's inputs ───────────────────────────────────────────

// The parts of an input that matter to the studio and to the request.
export function normInput(input = {}) {
  const out = { type: input.type || 'string' };
  if (Array.isArray(input.enum)) out.enum = sorted(input.enum);
  if (input.minValue != null) out.min = Number(input.minValue);
  if (input.maxValue != null) out.max = Number(input.maxValue);
  if (input.maxItems != null) out.maxItems = Number(input.maxItems);
  if (input.default !== undefined && input.default !== null) out.default = String(input.default);
  if (input.field) out.field = input.field;
  return out;
}

// [{ type, param, detail, safe }] — differences between two input maps.
export function diffInputs(before = {}, after = {}) {
  const items = [];
  for (const name of Object.keys(after)) {
    if (!before[name]) items.push({ type: 'param-added', param: name, detail: describe(after[name]), safe: false });
  }
  for (const name of Object.keys(before)) {
    if (!after[name]) { items.push({ type: 'param-removed', param: name, detail: describe(before[name]), safe: false }); continue; }
    const a = normInput(before[name]);
    const b = normInput(after[name]);
    if (same(a, b)) continue;
    if (a.type !== b.type || a.field !== b.field) {
      items.push({ type: 'param-changed', param: name, detail: `${a.type} → ${b.type}`, safe: false });
      continue;
    }
    if (a.enum || b.enum) {
      const added = (b.enum || []).filter((v) => !(a.enum || []).includes(v));
      const removed = (a.enum || []).filter((v) => !(b.enum || []).includes(v));
      if (added.length) items.push({ type: 'values-added', param: name, detail: added.join(', '), safe: Boolean(a.enum) });
      if (removed.length) items.push({ type: 'values-removed', param: name, detail: removed.join(', '), safe: false });
    }
    if (a.min !== b.min || a.max !== b.max) {
      const wider = (b.min ?? -Infinity) <= (a.min ?? -Infinity) && (b.max ?? Infinity) >= (a.max ?? Infinity);
      items.push({ type: 'range-changed', param: name, detail: `${a.min ?? '…'}–${a.max ?? '…'} → ${b.min ?? '…'}–${b.max ?? '…'}`, safe: wider });
    }
    if (a.maxItems !== b.maxItems) {
      items.push({ type: 'limit-changed', param: name, detail: `max ${a.maxItems ?? '?'} → ${b.maxItems ?? '?'}`, safe: (b.maxItems ?? 0) > (a.maxItems ?? Infinity) });
    }
    if (a.default !== b.default) {
      const fits = b.enum ? b.enum.includes(b.default) : b.min == null || (Number(b.default) >= b.min && Number(b.default) <= (b.max ?? Infinity));
      items.push({ type: 'default-changed', param: name, detail: `${a.default ?? '—'} → ${b.default ?? '—'}${fits ? '' : ' (outside the allowed values)'}`, safe: false });
    }
  }
  return items;
}

function describe(input) {
  const n = normInput(input);
  if (n.enum) return n.enum.join(', ');
  if (n.min != null || n.max != null) return `${n.min ?? '…'}–${n.max ?? '…'}`;
  if (n.maxItems != null) return `up to ${n.maxItems}`;
  return n.type;
}

// ── APIMart specs from the docs ────────────────────────────────────────────

// One APIMart override as { mode: { input: spec } }, media fields included.
export function flattenOverride(o) {
  const out = {};
  for (const [mode, spec] of Object.entries(o?.modes || {})) {
    const inputs = { ...(o.common?.inputs || {}), ...(spec.inputs || {}) };
    for (const [kind, m] of Object.entries(spec.media || {})) {
      inputs[`${kind} files → ${m.field}`] = { type: 'array', field: kind, maxItems: m.max || 1 };
      if (m.last) inputs[`last frame → ${m.last}`] = { type: 'string', field: kind };
    }
    for (const [k, v] of Object.entries(spec.fixed || {})) inputs[`fixed ${k}`] = { type: 'string', enum: [v] };
    out[mode] = inputs;
  }
  return out;
}

// [{ type, mode?, param?, detail, safe }] — what the new docs change for one model.
export function diffOverride(before, after) {
  if (!before && after) return [{ type: 'model-added', detail: after.docTitle || '', safe: false }];
  if (before && !after) return [{ type: 'model-missing', detail: 'No longer found in the docs — kept as is.', safe: false, info: true }];
  const items = [];
  if (!same(before.rename || {}, after.rename || {})) items.push({ type: 'rename-changed', detail: `${JSON.stringify(before.rename || {})} → ${JSON.stringify(after.rename || {})}`, safe: false });
  const a = flattenOverride(before);
  const b = flattenOverride(after);
  for (const mode of Object.keys(b)) if (!a[mode]) items.push({ type: 'mode-added', mode, detail: mode, safe: false });
  for (const mode of Object.keys(a)) {
    if (!b[mode]) { items.push({ type: 'mode-removed', mode, detail: mode, safe: false }); continue; }
    for (const item of diffInputs(a[mode], b[mode])) items.push({ ...item, mode });
  }
  // The same change in several modes is one change.
  const seen = new Set();
  return items.filter((i) => {
    const key = `${i.type}|${i.param || ''}|${i.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Catalog snapshots (every provider) ─────────────────────────────────────

// endpoint → { name, provider, inputs, price } for the variants of one provider.
export function snapshotOf(variants) {
  const out = {};
  for (const v of variants) {
    const inputs = {};
    for (const [k, input] of Object.entries(v.model?.inputs || {})) inputs[k] = normInput(input);
    out[v.key] = { name: `${v.model?.dzFamilyName || v.providerModel} · ${v.mode}`, inputs, price: v.model?.dzPrice?.label || null };
  }
  return out;
}

export function diffSnapshots(before, after, { params = true } = {}) {
  const items = [];
  for (const [endpoint, b] of Object.entries(after)) {
    const a = before[endpoint];
    if (!a) { items.push({ type: 'model-added', endpoint, name: b.name, detail: b.price || '' }); continue; }
    if (params) for (const item of diffInputs(a.inputs, b.inputs)) items.push({ ...item, endpoint, name: b.name });
    if (a.price !== b.price) items.push({ type: 'price-changed', endpoint, name: b.name, detail: `${a.price || '—'} → ${b.price || '—'}` });
  }
  for (const [endpoint, a] of Object.entries(before)) {
    if (!after[endpoint]) items.push({ type: 'model-removed', endpoint, name: a.name, detail: '' });
  }
  return items;
}

// ── The journal ────────────────────────────────────────────────────────────

export function createChanges({ dir, log, notify = null, now = () => Date.now() }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, name);
  let entries = readJson(file('changes.json'), []);
  if (!Array.isArray(entries)) entries = [];
  let counter = 0;

  function save() { writeJsonAtomic(file('changes.json'), entries.slice(0, MAX_ENTRIES)); }

  function record(list) {
    if (!list.length) return [];
    const at = now();
    const added = list.map((e) => ({ id: `chg_${at.toString(36)}_${(counter++).toString(36)}`, at, seen: false, ...e }));
    entries = [...added, ...entries].slice(0, MAX_ENTRIES);
    save();
    try { notify?.(added); } catch (error) { log?.warn(`changes notify: ${error.message}`); }
    return added;
  }

  // Catalog of one provider after a successful refresh. The first snapshot is
  // only saved — there is nothing to compare it with.
  function catalogChecked(providerId, variants, { params = true } = {}) {
    const snapFile = file(`snapshot-${providerId}.json`);
    const before = readJson(snapFile, null);
    const after = snapshotOf(variants);
    // A provider that suddenly lists far fewer models is an outage or a cut-off
    // answer, not a change: keep the old snapshot and say nothing.
    const was = Object.keys(before || {}).length;
    if (was && Object.keys(after).length < was * 0.7) {
      log?.warn(`changes: ${providerId} listed ${Object.keys(after).length} of ${was} models — snapshot kept`);
      return [];
    }
    writeJsonAtomic(snapFile, after);
    if (!before) return [];
    const status = providerId === 'apimart' ? 'info' : 'applied';
    return record(diffSnapshots(before, after, { params }).map((i) => ({ provider: providerId, source: 'catalog', status, ...i })));
  }

  const live = () => readJson(file('apimart-live.json'), {});
  // Per model: the spec in use before the last automatic change (null = the
  // bundled one), so a change that breaks requests can be undone by itself.
  const previous = () => readJson(file('apimart-previous.json'), {});
  // Docs versions that made the provider refuse requests: never applied again.
  const refused = () => readJson(file('apimart-refused.json'), {});
  let onSpecsChanged = null;

  // Fresh specs parsed from APIMart's docs: every difference is applied.
  // (APIMart's API lists models and prices but not what each setting accepts —
  // that is only in its docs.)
  function apimartDocsChecked(fresh, bundled, { total = 0, failed = 0, invalid = 0 } = {}) {
    const nextLive = live();
    const active = { ...bundled, ...nextLive };
    const freshCount = Object.keys(fresh).length;
    // Half-loaded docs must not look like dozens of removed settings.
    if ((total && (failed + invalid) / total > 0.15) || freshCount < Object.keys(active).length * 0.7) {
      log?.warn(`changes: APIMart docs check skipped — ${freshCount} models parsed, ${failed}/${total} pages failed, ${invalid} unreadable`);
      // A skip that keeps happening means the docs changed shape, not a bad download:
      // remembered, so the admin sees it (summary().docsStale) instead of one line a day.
      const m = meta();
      writeMeta({ docsSkippedSince: m.docsSkippedSince || now(), docsSkips: (m.docsSkips || 0) + 1, docsSkipReason: `${failed} of ${total} pages failed, ${invalid} without parameters, ${freshCount} models read` });
      return record([{ provider: 'apimart', source: 'docs', status: 'info', type: 'check-skipped', detail: `Docs looked incomplete (${freshCount} models, ${failed} of ${total} pages failed, ${invalid} without parameters). Nothing changed.` }]);
    }
    writeMeta({ docsAppliedAt: now(), docsSkippedSince: null, docsSkips: 0, docsSkipReason: null });
    const prev = previous();
    const bad = refused();
    const out = [];
    for (const id of new Set([...Object.keys(active), ...Object.keys(fresh)])) {
      if (fresh[id] && same(bad[id], fresh[id])) continue; // this version broke requests before
      const items = diffOverride(active[id], fresh[id]);
      if (!items.length) continue;
      // The page is gone but APIMart still lists the model: keep what works.
      if (items.every((i) => i.info)) {
        if (!entries.some((e) => e.model === id && e.type === 'model-missing' && now() - e.at < 7 * DAY)) {
          out.push(...items.map((i) => ({ provider: 'apimart', source: 'docs', model: id, status: 'info', ...i })));
        }
        continue;
      }
      prev[id] = { spec: nextLive[id] ?? null, at: now(), fields: changedFields(items, active[id], fresh[id]) };
      nextLive[id] = fresh[id];
      out.push(...items.filter((i) => !i.info).map(({ safe: _s, ...i }) => ({ provider: 'apimart', source: 'docs', model: id, status: 'applied', ...i })));
    }
    writeJsonAtomic(file('apimart-live.json'), nextLive);
    writeJsonAtomic(file('apimart-previous.json'), prev);
    return record(out);
  }

  // Request field names a change touched (the provider's names: "size" for aspect_ratio, media fields).
  function changedFields(items, before, after) {
    const rename = { ...(before?.rename || {}), ...(after?.rename || {}) };
    const out = new Set();
    for (const i of items) {
      if (i.param) {
        const p = i.param.includes('→') ? i.param.split('→').pop().trim() : i.param.replace(/^fixed /, '');
        out.add(p);
        if (rename[p]) out.add(rename[p]);
      }
      // Whole-mode or field-name changes touch every field of the model.
      if (['mode-added', 'mode-removed', 'rename-changed', 'model-added'].includes(i.type)) out.add('*');
    }
    return [...out];
  }

  // Was `value` one the new spec offers for this provider field? (If not, the
  // request didn't come from our studio's choices — not the spec's fault.)
  function offered(spec, field, value) {
    if (value === undefined) return true;
    const rename = spec?.rename || {};
    for (const inputs of Object.values(flattenOverride(spec))) {
      for (const [name, input] of Object.entries(inputs)) {
        if (name !== field && rename[name] !== field) continue;
        if (Array.isArray(input.enum) && !input.enum.map(String).includes(String(value))) return false;
        if (input.minValue != null && Number(value) < Number(input.minValue)) return false;
        if (input.maxValue != null && Number(value) > Number(input.maxValue)) return false;
      }
    }
    return true;
  }

  // A provider refused a request we built from its spec. Logged; and if that
  // model's spec was changed automatically in the last two weeks, the change
  // is undone at once (and that docs version is not applied again).
  function providerRejected({ provider, endpoint, model, status, message, params = [], body = {} }) {
    const text = String(message || '').slice(0, 400);
    // Must name one of the settings we sent (not the prompt): that is a spec problem.
    const named = params.filter((p) => p !== 'prompt' && new RegExp(`\\b${p.replace(/[^a-z0-9_]/gi, '')}\\b`, 'i').test(text));
    if (!named.length) return [];
    // Content moderation, balance and plain prompt problems are not spec changes.
    if (/policy|safety|sensitive|moderat|nsfw|violat|balance|quota|insufficient|credit/i.test(text)) return [];
    const out = [];
    if (provider === 'apimart' && model) {
      const prev = previous();
      const p = prev[model];
      const l0 = live();
      // Only when the refused setting is one the last change touched, with a value that change offers.
      const touched = p && (p.fields || ['*']).some((f) => f === '*' || named.includes(f));
      const fromOurSpec = named.every((f) => offered(l0[model], f, body[f]));
      if (p && now() - p.at < 14 * DAY && touched && fromOurSpec) {
        const l = live();
        const bad = refused();
        bad[model] = l[model];
        if (p.spec) l[model] = p.spec; else delete l[model];
        delete prev[model];
        writeJsonAtomic(file('apimart-refused.json'), bad);
        writeJsonAtomic(file('apimart-live.json'), l);
        writeJsonAtomic(file('apimart-previous.json'), prev);
        out.push({ provider, source: 'request', status: 'reverted', type: 'reverted', endpoint, model, param: named.join(', '), detail: 'APIMart refused a request after the last docs update — the previous settings are back.' });
        try { onSpecsChanged?.(); } catch (error) { log?.warn(`changes: rebuild — ${error.message}`); }
      }
    }
    const dupe = entries.some((e) => e.type === 'rejected' && e.endpoint === endpoint && e.detail === text && now() - e.at < DAY);
    if (!dupe) out.unshift({ provider, source: 'request', status: 'info', type: 'rejected', endpoint, model, param: named.join(', '), detail: text, http: status });
    return record(out);
  }

  const meta = () => readJson(file('changes-meta.json'), {});
  const writeMeta = (patch) => writeJsonAtomic(file('changes-meta.json'), { ...meta(), ...patch });
  // Skipped for more than two days in a row: the studio and Settings show a warning.
  function docsStale() {
    const m = meta();
    if (!m.docsSkips || !m.docsSkippedSince || now() - m.docsSkippedSince < 2 * DAY) return null;
    return { since: m.docsAppliedAt || m.docsSkippedSince, skippedSince: m.docsSkippedSince, skips: m.docsSkips, reason: m.docsSkipReason || '' };
  }

  function markSeen(id) {
    let changed = false;
    for (const e of entries) if (!e.seen && (!id || e.id === id)) { e.seen = true; changed = true; }
    if (changed) save();
  }

  return {
    record,
    catalogChecked,
    apimartDocsChecked,
    providerRejected,
    markSeen,
    liveOverrides: live,
    setOnSpecsChanged: (fn) => { onSpecsChanged = fn; },
    list: ({ limit = 200 } = {}) => entries.slice(0, limit),
    summary: () => ({
      unseen: entries.filter((e) => !e.seen).length,
      lastCheck: meta().lastDocsCheck || null,
      docsStale: docsStale(),
    }),
    setLastDocsCheck: (at) => writeMeta({ lastDocsCheck: at }),
    lastDocsCheck: () => meta().lastDocsCheck || 0,
  };
}
