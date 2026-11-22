"use client";

// Model and provider (redesign 01, §5.6): opens upward from the model chip, over
// the composer. Left: Recommended, vendors, This server, All models. Right: one
// row per model; the chosen model lists its providers (radio, tag, price).
import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, ImageSquare, Images, FilmStrip, SpeakerHigh, PencilSimple, TextAa } from "@phosphor-icons/react";
import { cn } from "../../ui/index.js";
import { Monogram } from "./ui.jsx";
import { paramsOf } from "../../dzCreate.js";

const SOUND = /^(generate_audio|audio|sound|enable_audio|with_audio)$/;

const LOCAL = new Set(["local", "h3", "server", "dz"]);
const priceOf = (entry) => {
  const p = entry.variants.map((v) => v.model.dzPrice).filter(Boolean).sort((a, b) => a.usd - b.usd)[0];
  return p ? { usd: p.usd, unit: p.unit } : null;
};
// "Cheapest" (A11): only when every provider has a known price for exactly these
// settings, and one is lower than all the others.
export function cheapestOf(providers, quotes) {
  const paid = providers.filter((p) => !p.local);
  if (paid.length < 2) return null;
  const usd = paid.map((p) => quotes[p.entry.key]?.usd);
  if (!usd.every(Number.isFinite)) return null;
  const min = Math.min(...usd);
  const at = usd.filter((x) => x === min).length === 1 ? paid[usd.indexOf(min)] : null;
  return at ? at.entry.key : null;
}
const fmt = (usd) => (usd === 0 ? "$0" : usd >= 0.1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3).replace(/0+$/, "")}`);
const UNIT = { second: "/s", image: "", generation: "", request: "", chars: "/1k chars" };

// Families with their providers, in catalog order.
export function familiesOf(entries) {
  const byFamily = new Map();
  for (const e of entries) {
    if (!byFamily.has(e.family)) byFamily.set(e.family, { family: e.family, name: e.familyName, vendor: e.vendorName, recommended: e.recommended, providers: [] });
    const f = byFamily.get(e.family);
    f.providers.push({ entry: e, price: priceOf(e), local: LOCAL.has(e.provider) });
    if (e.recommended != null && (f.recommended == null || e.recommended < f.recommended)) f.recommended = e.recommended;
  }
  for (const f of byFamily.values()) {
    const priced = f.providers.filter((p) => p.price);
    // "Cheapest" is set from real quotes for the current settings (cheapestOf), not here:
    // catalog prices mix "from" prices with one resolution's price (A11).
    f.from = priced.length ? priced.reduce((a, b) => (a.price.usd <= b.price.usd ? a : b)).price : null;
    f.local = f.providers.every((p) => p.local);
    const slots = new Set(f.providers.flatMap((p) => p.entry.slots.map((s) => s.role)));
    f.caps = { start: slots.has("first"), refs: slots.has("reference"), edit: slots.has("source"), editPic: f.providers.some((p) => p.entry.canEdit), text: GOOD_TEXT.test(f.name), sound: f.providers.some((p) => p.entry.variants.some((v) => { const ps = paramsOf(v.model); return [...ps.main, ...ps.advanced].some((x) => SOUND.test(x.key)); })) };
  }
  return [...byFamily.values()];
}

// Models known to write legible text in pictures. The providers publish no field for
// this, so it is a short list of our own (package 03, §3.2) — update it with the catalog.
const GOOD_TEXT = /\b(nano banana (pro|2)|gpt image|ideogram|seedream v?[45]|qwen image|recraft|flux\.?\s?2)\b/i;
const CAPS_BY_KIND = {
  video: [["start", ImageSquare, "start frame"], ["refs", Images, "references"], ["edit", FilmStrip, "video to edit"], ["sound", SpeakerHigh, "sound"]],
  image: [["refs", Images, "references"], ["editPic", PencilSimple, "edits a picture"], ["text", TextAa, "good at text"]],
};

export default function ModelMenu({ entries, entry, onPick, onClose, kind = entry?.kind || "video", quoteFor = null, count = 1 }) {
  const CAPS = CAPS_BY_KIND[kind] || CAPS_BY_KIND.video;
  const families = useMemo(() => familiesOf(entries), [entries]);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(() => (families.some((f) => f.recommended != null) ? "recommended" : "all"));
  const [openFamily, setOpenFamily] = useState(entry?.family || null);
  // Prices of the open family's providers for the current settings (A11): { [entry key]: price | null }.
  const [quotes, setQuotes] = useState({});
  const openProviders = useMemo(() => families.find((f) => f.family === openFamily)?.providers || [], [families, openFamily]);
  useEffect(() => {
    const paid = openProviders.filter((p) => !p.local);
    if (!quoteFor || paid.length < 2) return undefined;
    let alive = true;
    // Old prices stay until the new ones come (no flicker while the studio re-renders);
    // they are keyed by provider entry, so another family's prices never show here.
    // A moment's wait: clicking through families asks only for the one left open.
    const timer = setTimeout(() => {
      Promise.all(paid.map(async (p) => [p.entry.key, await quoteFor(p.entry)])).then((pairs) => { if (alive) setQuotes((q) => ({ ...q, ...Object.fromEntries(pairs) })); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [openProviders, quoteFor]);
  const vendors = useMemo(() => {
    const m = new Map();
    for (const f of families) if (!f.local) m.set(f.vendor, (m.get(f.vendor) || 0) + 1);
    return [...m.entries()];
  }, [families]);
  const groups = [
    ...(families.some((f) => f.recommended != null) ? [["recommended", "Recommended", families.filter((f) => f.recommended != null).length]] : []),
    ...vendors.map(([v, n]) => [`v:${v}`, v, n]),
    ...(families.some((f) => f.local) ? [["local", "This server", families.filter((f) => f.local).length]] : []),
    ["all", "All models", families.length],
  ];
  const needle = q.trim().toLowerCase();
  const shown = families.filter((f) => {
    if (needle) return `${f.name} ${f.vendor} ${f.providers.map((p) => p.entry.providerName).join(" ")}`.toLowerCase().includes(needle);
    if (group === "recommended") return f.recommended != null;
    if (group === "local") return f.local;
    if (group.startsWith("v:")) return f.vendor === group.slice(2) && !f.local;
    return true;
  }).sort((a, b) => (group === "recommended" ? (a.recommended ?? 1e9) - (b.recommended ?? 1e9) : 0));

  return (
    <div className="flex h-[min(560px,calc(100vh-160px))] w-[min(720px,calc(100vw-48px))] flex-col">
      {/* Values from package 02, §3: top block 16, vendors 12 / 200, list 12, rows 46 (0 12), providers 4 0 10 34 / 8. */}
      <div className="flex-shrink-0 border-b border-border p-4"><label className="flex h-9 items-center gap-2 rounded-md border border-input px-3">
        <MagnifyingGlass size={16} className="text-muted-foreground" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${families.length} models`} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none" />
      </label></div>
      <div className="flex min-h-0 flex-1">
        <nav className="custom-scrollbar w-[200px] flex-shrink-0 overflow-y-auto border-r border-border p-3" aria-label="Model groups">
          {groups.map(([id, label, n]) => (
            <button key={id} type="button" onClick={() => { setGroup(id); setQ(""); }}
              className={cn("flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-base font-medium transition-colors duration-state", group === id && !needle ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              <Monogram name={id === "recommended" ? "R" : id === "local" ? "S" : id === "all" ? "A" : label} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
            </button>
          ))}
        </nav>
        <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto p-3" role="listbox" aria-label="Models">
          {shown.length === 0 && <p className="p-6 text-center text-muted-foreground">No models found.</p>}
          {shown.map((f) => {
            const chosen = f.family === entry?.family;
            const expanded = f.family === openFamily && f.providers.length > 1;
            return (
              <div key={f.family} className="mb-1">
                <button type="button" role="option" aria-selected={chosen}
                  onClick={() => {
                    setOpenFamily(f.family);
                    let saved = null;
                    try { saved = localStorage.getItem(`dz_studio_provider_${f.family}`); } catch { /* storage is optional */ }
                    const keep = f.providers.find((p) => p.entry.key === entry?.key) || f.providers.find((p) => p.entry.key === saved) || f.providers[0];
                    onPick(keep.entry.key, { close: f.providers.length === 1 });
                  }}
                  className={cn("flex h-[46px] w-full items-center gap-2.5 rounded-slot border px-3 text-left transition-colors duration-state",
                    chosen ? "border-signal bg-signal/[.06]" : "border-transparent hover:bg-accent")}>
                  <Monogram name={f.vendor} />
                  <span className="truncate text-base font-semibold">{f.name}</span>
                  <span className="flex flex-shrink-0 items-center gap-1 text-muted-foreground">
                    {CAPS.filter(([k]) => f.caps[k]).map(([k, Icon, title]) => <Icon key={k} size={14} aria-label={title}><title>{title}</title></Icon>)}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-sm tabular-nums text-muted-foreground">
                    {f.local ? "Free · this server" : [f.from ? `from ${fmt(f.from.usd)}${UNIT[f.from.unit] || ""}` : "", `${f.providers.length} provider${f.providers.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  </span>
                </button>
                {expanded && (() => { const cheapest = cheapestOf(f.providers, quotes); return (
                  <div className="mb-2.5 ml-[34px] mt-1 rounded-slot border border-border p-2">
                    <div className="px-2 pb-1 pt-0.5"><span className="text-overline uppercase text-muted-foreground">Provider · {f.providers.length}</span></div>
                    {f.providers.map((p) => {
                      const on = p.entry.key === entry?.key;
                      return (
                        <button key={p.entry.key} type="button" role="radio" aria-checked={on}
                          onClick={() => { try { localStorage.setItem(`dz_studio_provider_${f.family}`, p.entry.key); } catch { /* optional */ } onPick(p.entry.key, { close: true }); onClose?.(); }}
                          className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-base transition-colors duration-state hover:bg-accent">
                          <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", on ? "border-signal" : "border-input")}>{on && <span className="h-2 w-2 rounded-full bg-signal" />}</span>
                          <span className="font-medium">{p.entry.providerName}</span>
                          {cheapest === p.entry.key && <span className="rounded-xs bg-signal/15 px-1.5 text-xs font-medium text-signal">Cheapest</span>}
                          {/* The price of this exact request when known (the settings now), else the catalog label. */}
                          <span className="ml-auto text-sm tabular-nums text-muted-foreground" title={quotes[p.entry.key] ? "For the current settings" : undefined}>
                            {p.local ? "Free" : quotes[p.entry.key] ? `${quotes[p.entry.key].exact ? "" : "≈ "}${fmt(quotes[p.entry.key].usd * Math.max(1, count))}` : p.entry.priceLabel || "—"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ); })()}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {CAPS.map(([k, Icon, title]) => <span key={k} className="flex items-center gap-1"><Icon size={12} /> {title}</span>)}
      </div>
    </div>
  );
}
