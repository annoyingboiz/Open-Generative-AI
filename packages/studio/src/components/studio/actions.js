// Grid and viewer actions shared by Studio, Image and Video (package 03, §5–§7).
import { useCallback, useEffect, useState } from "react";

async function post(url, body) {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.detail || data?.error || `Request failed (${res.status})`);
  return data;
}

// Try a failed generation again: same request, model, place.
export const dzRetry = (id) => post(`/dz/api/generations/${encodeURIComponent(id)}/retry`);

// A frame of a finished video: at "first" | "last" | seconds. save → a picture in
// the library next to the video ({ id }); otherwise an upload for a Start frame ({ url }).
export const dzFrame = (id, { at = "last", save = false } = {}) => post(`/dz/api/generations/${encodeURIComponent(id)}/frame`, { at, save });

export const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
export const refreshHistory = (studio) => window.dispatchEvent(new CustomEvent("dz:history", { detail: studio ? { studio } : {} }));

// "New" on a finished tile until it is hovered or opened (§3.3). Items made before
// this feature first ran are never new.
const SEEN = "dz_seen_v1";
const SINCE = "dz_seen_since";
let seenSet = null;
let since = 0;
const listeners = new Set();
function load() {
  if (seenSet) return;
  seenSet = new Set();
  try {
    seenSet = new Set(JSON.parse(localStorage.getItem(SEEN) || "[]"));
    since = Number(localStorage.getItem(SINCE)) || 0;
    if (!since) { since = Date.now(); localStorage.setItem(SINCE, String(since)); }
  } catch { since = Date.now(); }
}
export function useSeen() {
  const [, bump] = useState(0);
  useEffect(() => { load(); const on = () => bump((n) => n + 1); listeners.add(on); return () => listeners.delete(on); }, []);
  const isNew = useCallback((item) => {
    load();
    return Boolean(item?.url && item.created_at > since && !seenSet.has(item.id));
  }, []);
  const markSeen = useCallback((item) => {
    load();
    if (!item?.id || seenSet.has(item.id)) return;
    seenSet.add(item.id);
    try { localStorage.setItem(SEEN, JSON.stringify([...seenSet].slice(-2000))); } catch { /* optional */ }
    listeners.forEach((f) => f());
  }, []);
  return { isNew, markSeen };
}

// The provider's error in plain words (§3.3). Unknown ones are shown as they are.
export function plainError(raw) {
  const t = String(raw || "").replace(/^API Request Failed: \d+ [^-]*- /, "").trim();
  if (!t) return "The provider gave no reason.";
  if (/safety|content|moderat|policy|nsfw|sensitive|blocked/i.test(t)) return "The provider rejected the prompt or a picture: content filter.";
  if (/timed? ?out|timeout/i.test(t)) return "The provider took too long and stopped.";
  // A real empty account first; then APIMart's generic failure ("The task failed… Any deducted
  // quota has been refunded"), which is the provider's own failure: "quota" alone is not credit.
  if (/insufficient|out of (credit|quota|balance)|no (credit|balance)|balance (is )?(too low|not enough|exhausted)|credits? (balance )?(exhausted|used up)|quota (exceeded|exhausted)|exceeded.*quota|top up/i.test(t)) return "The provider account is out of credit.";
  if (/task failed|refunded/i.test(t)) return "The provider failed on its side. Try again later, or switch this model to another provider.";
  if (/interrupted/i.test(t)) return t;
  // "HTTP 400: kling-v4 video-edit requires `prompt`" → a sentence a person can act on.
  const needs = /requires\s+`?([a-z_]+)`?/i.exec(t);
  if (needs) return needs[1].toLowerCase() === "prompt" ? "This model needs a prompt for this request. Write one and try again." : `This model needs “${needs[1]}” for this request.`;
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

// How long this model usually takes, from finished items in view (§4: "usually about N min").
export function usualMinutes(items, item) {
  const same = items.filter((i) => i.url && i.model === item.model && i.completed_at && i.created_at && i.completed_at > i.created_at).slice(0, 12);
  if (same.length < 2) return null;
  const sorted = same.map((i) => i.completed_at - i.created_at).sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return Math.max(1, Math.round(mid / 60000));
}

// What the server measured on a finished video (docs/ux/44, decision b): flags, never a rejection.
// → [{ id, text, note }]. Drift and the measured shot size join this list later.
export function checkBadges(item) {
  const c = item?.status === "completed" || item?.url ? item?.checks : null;
  const out = [];
  const cuts = Array.isArray(c?.cuts) && c.cuts.length ? c.cuts : c?.cut ? [c.cut] : [];
  const at = cuts.map((x) => Number(x.at)).filter(Number.isFinite);
  if (at.length) {
    out.push({ id: "cut", tile: true, text: at.length === 1 ? `Cut at ${at[0].toFixed(1)} s` : `${at.length} cuts: ${at.map((t) => `${t.toFixed(1)} s`).join(", ")}`,
      note: `The clip jumps to another camera position ${at.length === 1 ? "here" : "at these moments"}, although it was asked as one continuous shot.` });
  }
  // Camera drift from the picture's scale (docs/ux/44 b, 46 §6.4): more than 15 % first to last frame.
  const z = Number(c?.drift?.zoom);
  if (c?.drift?.move && Number.isFinite(z)) {
    const pct = Math.round(Math.abs(z - 1) * 100);
    // A move was asked for: say what it did, in the viewer only, no warning.
    if (c.drift.asked) out.push({ id: "drift", quiet: true, tile: false, text: `Camera ${c.drift.move === "pull" ? "pulls back" : "pushes in"} ${pct} %`, note: "The camera move that was asked for, measured on the picture." });
    else out.push(c.drift.move === "pull"
      ? { id: "drift", tile: true, text: `Camera pulls back ${pct} %`, note: "The picture gets smaller during the clip, as if the camera moved away, although no move was asked for." }
      : { id: "drift", tile: true, text: `Camera pushes in ${pct} %`, note: "The picture gets larger during the clip, as if the camera moved closer, although no move was asked for." });
  }
  // Measured shot size, only when a face was found (docs/ux/44 c): a target, not a guarantee.
  const SHOT_NAMES = { full: "full body", knees: "knees up", waist: "waist up", "head-shoulders": "head and shoulders", face: "face" };
  if (c?.shot?.id && SHOT_NAMES[c.shot.id]) {
    const differs = c.shot.asked && c.shot.asked !== c.shot.id && SHOT_NAMES[c.shot.asked];
    // On the tile only when the prompt asked for a shot size (our FRAMING was sent); always in the viewer.
    out.push({ id: "shot", text: `Came out: ${SHOT_NAMES[c.shot.id]}${differs ? ` · asked for ${SHOT_NAMES[c.shot.asked]}` : ""}`, quiet: !differs, tile: Boolean(c.shot.asked),
      note: differs ? "The model framed the shot differently from the shot size in the prompt. Shot size is a target, not a guarantee." : "Measured from the face in the picture." });
  }
  // Colour shifted from the chain's first picture (measured after the picture arrived), not matched yet.
  // The tile has its own one-press chip (colourChip); here it is the viewer's line.
  const cc = c?.colour;
  if (cc?.state === "shifted" && !item?.colour && !colourIntended(item)) {
    out.push({ id: "colour", tile: false, noRetry: true, text: "Colour shifted from source", note: `${shiftText(cc.da, cc.db)} compared with the first picture of the chain. Match colour removes it; nothing is changed until then.` });
  }
  return out;
}

// "magenta +2.3, blue +1.8" (as the server words it).
export function shiftText(da, db) {
  const p = [];
  if (Math.abs(da) >= 0.3) p.push(`${da > 0 ? "magenta" : "green"} +${Math.abs(da).toFixed(1)}`);
  if (Math.abs(db) >= 0.3) p.push(`${db > 0 ? "yellow" : "blue"} +${Math.abs(db).toFixed(1)}`);
  return p.join(", ") || "A slight tint";
}
// Made with a look or camera setting, or a re-shoot: its colour changed on purpose (docs/ux/research/
// color-badge-review.md §3). No badge on the tile; the viewer keeps the button with a warning line.
export function colourIntended(item) {
  const m = item?.meta || {};
  const l = m.look;
  return Boolean(m.reshootOf || (l && (l.on || l.filter || l.era || l.light || l.palette || l.genre)));
}
// The tile's colour chip (docs/ux/research, the badge): shifted → one press matches; matched → a quiet
// note with Show original; original shown → a quiet note with Use matched. null: nothing to show.
export function colourChip(item) {
  if (!item || item.kind !== "image") return null;
  if (item.colour) return item.colour.on ? { state: "matched", text: "Colour matched", action: "Show original", to: "original" } : { state: "original", text: "Original colour", action: "Use matched", to: "matched" };
  const cc = item.checks?.colour;
  if (cc?.state === "shifted" && !colourIntended(item)) return { state: "shifted", text: "Colour shifted from source", action: "Match", to: "match", note: shiftText(cc.da, cc.db) };
  return null;
}

// A picture made from a source picture (Image to Edit, Advanced Editor base, canvas extension):
// "Match colour to source" applies to it (docs/ux/research/color-fidelity-answers.md).
export function hasColourSource(item) {
  if (!item || item.kind !== "image" || item.status !== "completed") return false;
  const m = item.meta || {};
  const u = m.attached?.edit?.[0]?.url || m.editor?.source || m.canvas?.source;
  return typeof u === "string" && /^\/media\/(g|u)\//.test(u);
}
// The server's answer as one line for the user.
export function colourLine(r) {
  if (!r) return "";
  if (r.state === "matched") return `Colour matched to the source: ${r.words} removed.`;
  if (r.state === "original") return `Showing the provider's original. Matched colour: ${r.words} removed.`;
  if (r.state === "no-shift") return "No colour shift found.";
  if (r.state === "unavailable") return r.reason || "Can't match this picture.";
  return "";
}
