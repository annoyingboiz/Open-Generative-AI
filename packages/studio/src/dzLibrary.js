"use client";

// DZ: the server-side Library — history on any device, likes, trash.
// Every studio reads its history from the server (each user sees only their
// own). Jobs keep running on the server, so after a reload a running job
// shows up as "processing" and turns into a result by itself.
import { useCallback, useEffect, useRef, useState } from "react";

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch { /* keep */ }
    throw new Error(detail);
  }
  return res.json();
}

const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dz:history", { detail: { status: "changed" } })); };

export const dzLibrary = {
  list(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false).map(([k, v]) => [k, v === true ? "1" : String(v)]));
    return call("GET", `/api/v1/history?${q}`);
  },
  async like(id, liked) { const r = await call("POST", `/api/v1/predictions/${encodeURIComponent(id)}/like`, { liked }); changed(); return r; },
  async trash(id) { const r = await call("DELETE", `/api/v1/predictions/${encodeURIComponent(id)}/media`); changed(); return r; },
  // Stop a job that is still waiting or running (this server's jobs).
  async cancel(id) { const r = await call("POST", `/api/v1/predictions/${encodeURIComponent(id)}/cancel`); changed(); return r; },
  // Texture filter on a finished video (handoff 17, §6): re-rendered on the server, free.
  async texture(id, { on, strength }) { const r = await call("POST", `/dz/api/generations/${encodeURIComponent(id)}/texture`, { on, strength }); changed(); return r; },
  // "Match colour to source" (docs/ux/research/color-fidelity-answers.md): free, by button.
  colour(id) { return call("GET", `/dz/api/generations/${encodeURIComponent(id)}/colour`); },
  async setColour(id, to) { const r = await call("POST", `/dz/api/generations/${encodeURIComponent(id)}/colour`, { to }); changed(); return r; },
  async restore(id) { const r = await call("POST", `/api/v1/predictions/${encodeURIComponent(id)}/restore`); changed(); return r; },
  // One action on many items: { action: move|copy|trash|restore|purge, ids, project?, folder? } → { done, failed }.
  async batch(action, ids, target = {}) {
    const r = await call("POST", "/api/v1/predictions/batch", { action, ids, project: target.project || null, folder: target.folder || null });
    changed();
    return r;
  },
  async purge(id) { const r = await call("DELETE", `/api/v1/predictions/${encodeURIComponent(id)}`); changed(); return r; },
  // Delete uploaded files for good: { done, failed }.
  async deleteUploads(ids) {
    const r = await call("POST", "/api/v1/uploads/delete", { ids });
    window.dispatchEvent(new CustomEvent("dz:history", { detail: { status: "upload" } }));
    return r;
  },
  uploads(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    return call("GET", `/api/v1/uploads?${q}`);
  },
};

// History for one view. `filter` goes to /api/v1/history (studio, kind,
// liked, trash, status). Refreshes when a generation starts or finishes
// anywhere in the app, and every few seconds while something is running.
export function useDzHistory(filter = {}, { limit = 60 } = {}) {
  const key = JSON.stringify(filter);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  // A new filter starts from an empty list (no stale items from the old one).
  useEffect(() => { seq.current += 1; setItems([]); setLoaded(false); setCursor(null); }, [key]);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await dzLibrary.list({ ...JSON.parse(key), limit });
      if (mine !== seq.current) return;
      setItems(data.items || []);
      setCursor(data.next_cursor && (data.items || []).length >= limit ? data.next_cursor : null);
    } catch { /* keep the old list */ }
    if (mine === seq.current) setLoaded(true);
  }, [key, limit]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const data = await dzLibrary.list({ ...JSON.parse(key), limit, cursor });
      if (mine !== seq.current) { setLoadingMore(false); return; }
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...(data.items || []).filter((i) => !seen.has(i.id))];
      });
      setCursor(data.next_cursor && (data.items || []).length >= limit ? data.next_cursor : null);
    } catch { /* try again later */ }
    setLoadingMore(false);
  }, [cursor, loadingMore, key, limit]);

  useEffect(() => { refresh(); }, [refresh]);
  // Events from anywhere in the app, debounced; a generation event only
  // refreshes views that can show that studio.
  useEffect(() => {
    const studios = JSON.parse(key).studio ? String(JSON.parse(key).studio).split(",") : null;
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
    const onHistory = (e) => {
      const st = e.detail?.studio;
      if (st && studios && !studios.includes(st)) return;
      later();
    };
    window.addEventListener("dz:history", onHistory);
    window.addEventListener("focus", later);
    return () => { clearTimeout(timer); window.removeEventListener("dz:history", onHistory); window.removeEventListener("focus", later); };
  }, [refresh, key]);
  // While something runs, check every few seconds — only while the page is visible.
  const running = items.some((i) => i.status === "processing");
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 4000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  // Optimistic like / trash so the card reacts at once.
  const like = useCallback(async (id, liked) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, liked } : i)));
    try { await dzLibrary.like(id, liked); } catch (e) { refresh(); throw e; }
  }, [refresh]);
  const trash = useCallback(async (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try { await dzLibrary.trash(id); } catch (e) { refresh(); throw e; }
  }, [refresh]);

  return { items, loaded, refresh, loadMore, hasMore: Boolean(cursor), loadingMore, like, trash };
}
