"use client";

// Small building blocks of the Studio screen (redesign package 01). Values come
// from docs/ux/handoff/01-studio (README §3, §5; studio.css); built on our UI kit.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { cn } from "../../ui/index.js";

// 11 px caps title (group titles in the strip, panels, menus).
export const Overline = ({ className, children }) => <span className={cn("text-overline uppercase text-muted-foreground", className)}>{children}</span>;

// Esc closes the topmost thing (§5.11): every layer registers itself; the last one wins.
const layers = [];
export function useEscLayer(open, onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const me = () => ref.current?.();
    layers.push(me);
    return () => { const i = layers.lastIndexOf(me); if (i >= 0) layers.splice(i, 1); };
  }, [open]);
}
if (typeof window !== "undefined" && !window.__dzEscLayers) {
  window.__dzEscLayers = true;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !layers.length) return;
    // Radix popovers and menus close themselves first.
    if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
    e.preventDefault();
    layers[layers.length - 1]();
  });
}

// Mounted while open plus the exit time, so panels can slide out.
export function usePresence(open, ms = 260) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const t = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted, shown };
}

// Side panel (§5.9): full window height over the header, scrim behind, glass;
// head 56 px (title, ×), body padding 20, foot: Reset on the left, Done on the right.
export function StudioPanel({ open, onClose, title, aside, width = 640, onReset, resetLabel = "Reset", foot, children, bodyClassName }) {
  const { mounted, shown } = usePresence(open, 260);
  useEscLayer(open, onClose);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[150]">
      <div className={cn("absolute inset-0 bg-scrim transition-opacity duration-200 ease-out", shown ? "opacity-100" : "opacity-0")} onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-label={title} style={{ width: `min(${width}px, 100vw)` }}
        className={cn("glass absolute inset-y-0 right-0 flex flex-col border-l border-border shadow-float transition-transform duration-sheet ease-soft", shown ? "translate-x-0" : "translate-x-full")}>
        <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-border px-5">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
          {aside}
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground"><X size={16} /></button>
        </header>
        <div className={cn("custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5", bodyClassName)}>{children}</div>
        <footer className="flex h-14 flex-shrink-0 items-center gap-2 border-t border-border px-5">
          {foot || (
            <>
              {onReset && <button type="button" onClick={onReset} className="h-8 rounded-md px-3 text-base font-medium text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground">{resetLabel}</button>}
              <button type="button" onClick={onClose} className="ml-auto h-8 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground transition-colors duration-state hover:bg-primary-hover active:scale-[.98]">Done</button>
            </>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

// A chip in the composer's bottom row (32 px).
export function Chip({ icon: Icon, children, active, className, ...rest }) {
  return (
    <button type="button" {...rest}
      className={cn("flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium text-foreground transition-colors duration-state hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        active && "bg-accent", className)}>
      {Icon && <Icon size={14} className="shrink-0 text-muted-foreground" />}
      {children}
    </button>
  );
}

// Popover from a chip (§5.7): glass, opens upward, 180 ms (8 px up + scale .98 → 1).
export function ChipMenu({ open, onClose, anchor, className, align = "start", children }) {
  const { mounted, shown } = usePresence(open, 180);
  useEscLayer(open, onClose);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose, anchor]);
  if (!mounted) return null;
  return (
    <div ref={ref} role="dialog"
      className={cn("glass absolute bottom-[calc(100%+8px)] z-30 rounded-xl border border-border shadow-popover transition-[opacity,transform] duration-popover ease-soft",
        align === "end" ? "right-0 origin-bottom-right" : "left-0 origin-bottom-left",
        shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[.98] opacity-0", className)}>
      {children}
    </div>
  );
}

// A menu row (36 px), selected: --accent fill.
export function MenuRow({ on, disabled, children, className, ...rest }) {
  return (
    <button type="button" disabled={disabled} {...rest}
      className={cn("flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-base font-medium transition-colors duration-state",
        on ? "bg-accent text-foreground" : "text-foreground hover:bg-accent", disabled && "cursor-not-allowed text-subtle hover:bg-transparent", className)}>
      {children}
    </button>
  );
}

// Monogram of a vendor (models list): "K" in a rounded square.
export const Monogram = ({ name, className }) => (
  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-muted text-xs font-semibold text-foreground", className)}>{String(name || "?").trim().charAt(0).toUpperCase()}</span>
);

export const fmtDur = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
