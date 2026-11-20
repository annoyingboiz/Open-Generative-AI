"use client";

// DZ compositions on top of the official shadcn/ui components (./shadcn,
// added with `npx shadcn@2.3.0 add …`). Only things shadcn has no ready
// component for live here.
import { useEffect, useRef, useState } from "react";
import { cn } from "./utils.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./shadcn/select.jsx";
import { ToggleGroup, ToggleGroupItem } from "./shadcn/toggle-group.jsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./shadcn/tooltip.jsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./shadcn/sheet.jsx";

// Select whose options have a description and a right-side value (price…).
//   <OptionSelect value onValueChange options=[{ value, label, description, meta, icon }] />
export function OptionSelect({ value, onValueChange, options, placeholder = "Choose…", className, "aria-label": ariaLabel }) {
  const current = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className={cn("h-auto min-h-11 rounded-xl px-3.5 py-2 text-left", className)}>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {current?.icon}
          <span className="min-w-0">
            <span className="block truncate font-semibold">{current ? current.label : placeholder}</span>
            {current?.description && <span className="block truncate text-muted-foreground">{current.description}</span>}
          </span>
        </span>
        {current?.meta && <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">{current.meta}</span>}
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[420px] rounded-xl">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} className="items-start rounded-lg py-2.5 pr-9">
            <span className="flex w-full items-start gap-3">
              {o.icon}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.label}</span>
                {o.description && <span className="block text-muted-foreground">{o.description}</span>}
              </span>
              {o.meta && <span className="shrink-0 tabular-nums text-muted-foreground">{o.meta}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// One-of-N choice (shadcn ToggleGroup, single). Values may be numbers.
// The small segmented switch of the Studio composer (Image | Video); also the Storyboard's
// References | Generated (package 06, S5). options: [[value, label], …]
export function SegSwitch({ value, onChange, options, className, "aria-label": ariaLabel }) {
  return (
    <div className={cn("flex h-8 flex-shrink-0 items-center rounded-md bg-muted p-0.5", className)} role="group" aria-label={ariaLabel}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={cn("h-7 rounded-[6px] px-2.5 text-sm font-medium transition-colors duration-state", value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
      ))}
    </div>
  );
}

export function Segmented({ value, onChange, options, className, size = "default", "aria-label": ariaLabel }) {
  const opts = options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  return (
    <ToggleGroup
      type="single"
      value={String(value)}
      onValueChange={(v) => { if (!v) return; const o = opts.find((x) => String(x.value) === v); if (o) onChange(o.value); }}
      aria-label={ariaLabel}
      className={cn("w-full gap-1 rounded-xl bg-muted p-1", className)}
    >
      {opts.map((o) => (
        <ToggleGroupItem
          key={String(o.value)}
          value={String(o.value)}
          disabled={o.disabled}
          className={cn(
            "flex-1 whitespace-nowrap rounded-lg font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
            size === "sm" ? "h-9 px-3" : "h-10 px-4",
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// <Tip text="…">{trigger}</Tip>
export function Tip({ text, children, side = "top" }) {
  if (!text) return children;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="z-[300] max-w-xs rounded-lg px-3 py-2 leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Small "i" that explains a setting on hover or focus.
export function InfoTip({ text }) {
  if (!text) return null;
  return (
    <Tip text={text}>
      <button type="button" aria-label="More info" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[13px] font-bold leading-none text-muted-foreground hover:text-foreground">
        i
      </button>
    </Tip>
  );
}

function useWide(query = "(min-width: 768px)") {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

// Side panel (shadcn Sheet). Desktop: non-modal, below the header — the page
// stays usable. Narrow screens: a real modal. Focus returns to the opener.
export function SidePanel({ open, onOpenChange, title, actions, children, className }) {
  const wide = useWide();
  const opener = useRef(null);
  useEffect(() => {
    if (open && !opener.current && typeof document !== "undefined") opener.current = document.activeElement;
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={!wide}>
      <SheetContent
        side="right"
        onInteractOutside={(e) => { if (wide) e.preventDefault(); }}
        onCloseAutoFocus={(e) => {
          const el = opener.current;
          opener.current = null;
          if (el && typeof el.focus === "function" && document.contains(el)) { e.preventDefault(); el.focus(); }
        }}
        className={cn("top-14 z-[70] flex h-auto w-full max-w-[420px] flex-col gap-0 bg-card p-0 sm:max-w-[420px] [&>button.absolute]:top-3.5 [&>button.absolute]:right-4", className)}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border py-3 pl-5 pr-14 text-left">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {actions}
        </SheetHeader>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        <div className="min-h-0 flex-1">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function SectionLabel({ className, ...props }) {
  return <div className={cn("text-base font-semibold text-muted-foreground", className)} {...props} />;
}

export function Spinner({ className }) {
  return <span className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-signal/25 border-t-primary", className)} aria-hidden />;
}

// Vendor or model logo (from the provider catalog, served by our server).
// Falls back to initials when there is no logo or it fails to load.
export function Logo({ src, name = "", size = 36, className }) {
  const initials = String(name).replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "AI";
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-overlay-foreground font-bold text-overlay/70", className)}
      style={{ width: size, height: size, fontSize: Math.max(16, Math.round(size * 0.4)) }}
      aria-hidden
    >
      <span>{initials}</span>
      {src && (
        <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full bg-overlay-foreground object-contain p-1" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}
    </span>
  );
}

// Tabs in one line (shadcn Tabs look). If they don't fit, the row scrolls
// sideways: no visible scrollbar, soft fades at the edges, arrow buttons,
// mouse wheel scrolls it, and the active tab is kept in view.
export function ScrollTabs({ value, onChange, items, className, "aria-label": ariaLabel }) {
  const row = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, [items.length]);
  useEffect(() => {
    const active = row.current?.querySelector('[data-state="active"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  const scrollBy = (dx) => row.current?.scrollBy({ left: dx, behavior: "smooth" });
  const Arrow = ({ dir }) => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={() => scrollBy(dir * 180)}
      className={cn(
        "absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-popover text-foreground shadow-md transition-opacity hover:bg-accent",
        dir < 0 ? "left-0.5" : "right-0.5",
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d={dir < 0 ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} /></svg>
    </button>
  );
  const mask = edges.left && edges.right
    ? "linear-gradient(to right, transparent, black 40px, black calc(100% - 40px), transparent)"
    : edges.left ? "linear-gradient(to right, transparent, black 40px)"
    : edges.right ? "linear-gradient(to right, black calc(100% - 40px), transparent)" : undefined;
  return (
    <div className={cn("relative rounded-xl bg-muted p-1", className)}>
      {edges.left && <Arrow dir={-1} />}
      <div
        ref={row}
        role="tablist"
        aria-label={ariaLabel}
        onScroll={measure}
        className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
      >
        {items.map((it) => {
          const active = it.value === value;
          return (
            <button
              key={it.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-state={active ? "active" : "inactive"}
              onClick={() => onChange(it.value)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          );
        })}
      </div>
      {edges.right && <Arrow dir={1} />}
    </div>
  );
}
