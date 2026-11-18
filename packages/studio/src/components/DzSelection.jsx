"use client";

// DZ: choosing several results at once — in All work and in every tool's grid.
//   · only "Select" starts choosing (a plain click always opens the result);
//   · while choosing, a click picks one, Shift-click a range;
//   · Move to… / Copy to… / Download / Trash for what is chosen;
//   · cards can be dragged onto a folder or a project in the sidebar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzLibrary } from "../dzLibrary.js";
import { Button, cn } from "../ui/index.js";

export const DZ_DRAG_TYPE = "application/x-dz-items";

// Messages for the shell's notifications (bottom right).
export function dzNotify(type, title, message) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type, title, message } }));
}

// Result of a batch call → one short line.
export function dzBatchSummary(verb, r) {
  const done = r?.done?.length || 0;
  const failed = r?.failed || [];
  if (!failed.length) return { type: "success", text: `${verb} ${done} item${done === 1 ? "" : "s"}.` };
  const why = failed[0]?.error ? ` (${failed[0].error})` : "";
  return { type: done ? "success" : "error", text: `${verb} ${done}. ${failed.length} could not be${why}.` };
}

export function useDzSelection(items) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);

  // Items that left the list (moved, trashed, filtered out) leave the selection.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const clear = useCallback(() => { setSelected(new Set()); setSelecting(false); anchor.current = null; }, []);
  // A finished Move/Copy (the dialog lives in the shell) ends choosing.
  useEffect(() => {
    const on = () => clear();
    window.addEventListener("dz:moved", on);
    return () => window.removeEventListener("dz:moved", on);
  }, [clear]);
  useEffect(() => {
    if (!selecting) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) clear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clear]);

  const toggle = useCallback((item, e = {}) => {
    if (!item?.url) return;
    setSelecting(true);
    const idx = items.findIndex((i) => i.id === item.id);
    setSelected((prev) => {
      const next = new Set(prev);
      const from = anchor.current ? items.findIndex((i) => i.id === anchor.current) : -1;
      if (e.shiftKey && from >= 0 && idx >= 0) {
        const [lo, hi] = from < idx ? [from, idx] : [idx, from];
        for (let k = lo; k <= hi; k += 1) if (items[k].url) next.add(items[k].id);
        return next;
      }
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
    anchor.current = item.id;
  }, [items]);

  // A click on a card: true when it was a choosing click (the card then does nothing else).
  const click = useCallback((item, e) => {
    if (!selecting) return false;
    e.preventDefault?.();
    toggle(item, e);
    return true;
  }, [selecting, toggle]);

  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const selectAll = useCallback(() => setSelected(new Set(items.filter((i) => i.url).map((i) => i.id))), [items]);

  // Dragging a chosen card takes all chosen ones; any other card goes alone.
  const dragProps = useCallback((item) => ({
    draggable: Boolean(item.url),
    onDragStart: (e) => {
      const ids = selected.has(item.id) ? [...selected] : [item.id];
      e.dataTransfer.setData(DZ_DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "copyMove";
    },
  }), [selected]);

  return { selecting, start: () => setSelecting(true), clear, click, toggle, selectAll, chosen, has: (id) => selected.has(id), count: selected.size, dragProps };
}

// The round tick in a card's top-left corner — only while choosing.
export function SelectBox({ sel, item, className }) {
  if (!item.url || !sel?.selecting) return null;
  const on = sel.has(item.id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? "Unselect" : "Select"}
      onClick={(e) => { e.stopPropagation(); sel.toggle(item, e); }}
      className={cn(
        "absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 transition-opacity",
        on ? "border-signal bg-signal text-primary-foreground opacity-100" : "border-overlay-foreground/80 bg-overlay/40 text-transparent",
        !on && (sel.selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"),
        className,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
    </button>
  );
}

// Ring around a chosen card.
export const selectedRing = (on) => (on ? "ring-2 ring-signal ring-offset-2 ring-offset-background" : "");

async function downloadOne(url) {
  try {
    const blob = await (await fetch(url)).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = url.split("/").pop().split("?")[0] || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank");
  }
}

// Where you are: "Library" or "● Project / Folder / Subfolder".
export function Breadcrumb({ ctx, title }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-base">
      {ctx.project ? (
        <>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ctx.project.color }} />
          <span className={cn("truncate", ctx.folderPath?.length ? "text-muted-foreground" : "font-semibold text-foreground")}>{ctx.project.name}</span>
          {(ctx.folderPath || []).map((name, i, all) => (
            <span key={`${i}-${name}`} className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground/60">/</span>
              <span className={cn("truncate", i === all.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground")}>{name}</span>
            </span>
          ))}
        </>
      ) : (
        <span className="font-semibold text-foreground">Library</span>
      )}
      {title && <span className="truncate text-muted-foreground">· {title}</span>}
    </div>
  );
}

// The strip above a grid: where you are and filters, or — while choosing — what to do with the chosen.
export function GridToolbar({ ctx, sel, title, inTrash = false, children, canSelect = true }) {
  const [busy, setBusy] = useState(false);
  const run = async (action, verb) => {
    setBusy(true);
    try {
      const r = await dzLibrary.batch(action, sel.chosen.map((i) => i.id));
      const s = dzBatchSummary(verb, r);
      dzNotify(s.type, verb, s.text);
      if (r.done?.length) sel.clear();
    } catch (e) {
      dzNotify("error", verb, String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const openMove = (mode) => window.dispatchEvent(new CustomEvent("dz:move", { detail: { items: sel.chosen, mode } }));
  const downloadAll = async () => {
    for (const item of sel.chosen) {
      for (const url of item.outputs?.length ? item.outputs : [item.url]) {
        await downloadOne(url);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  };

  if (sel?.selecting) {
    const n = sel.count;
    return (
      <div className="flex min-h-[44px] flex-wrap items-center gap-2 rounded-xl border border-signal/30 bg-signal/10 px-3 py-1.5">
        <span className="mr-1 font-semibold text-foreground tabular-nums">{n ? `${n} selected` : "Choose items"}</span>
        <Button size="sm" variant="ghost" onClick={sel.selectAll}>Select all</Button>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {inTrash ? (
          <>
            <Button size="sm" variant="secondary" disabled={!n || busy} onClick={() => run("restore", "Restored")}>Restore</Button>
            <Button size="sm" variant="destructive" disabled={!n || busy} onClick={() => { if (window.confirm(`Delete ${n} item${n === 1 ? "" : "s"} for good? This can't be undone.`)) run("purge", "Deleted"); }}>Delete forever</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" disabled={!n || busy} onClick={() => openMove("move")}>Move to…</Button>
            <Button size="sm" variant="secondary" disabled={!n || busy} onClick={() => openMove("copy")}>Copy to…</Button>
            <Button size="sm" variant="secondary" disabled={!n || busy} onClick={downloadAll}>Download</Button>
            <Button size="sm" variant="secondary" disabled={!n || busy} onClick={() => window.dispatchEvent(new CustomEvent("dz:to-element", { detail: { items: sel.chosen } }))}>To element…</Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!n || busy} onClick={() => run("trash", "Moved to trash")}>Trash</Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={sel.clear}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-2">
      <Breadcrumb ctx={ctx} title={title} />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        {canSelect && sel && <Button size="sm" variant="secondary" onClick={sel.start}>Select</Button>}
      </div>
    </div>
  );
}
