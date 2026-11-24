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
  if (c?.cut && Number.isFinite(c.cut.at)) {
    out.push({ id: "cut", text: `Cut at ${c.cut.at.toFixed(1)} s`, note: "The clip jumps to another camera position here, although it was asked as one continuous shot." });
  }
  return out;
}
