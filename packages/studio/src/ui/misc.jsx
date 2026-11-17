"use client";

import { cn } from "./utils.js";

export function Badge({ className, variant = "default", ...props }) {
  const styles = {
    default: "bg-accent text-foreground",
    outline: "border border-border text-muted-foreground",
    primary: "bg-primary/15 text-primary",
    danger: "bg-destructive/15 text-destructive",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-base font-medium leading-6", styles[variant], className)} {...props} />;
}

export function Card({ className, ...props }) {
  return <div className={cn("rounded-2xl border border-border bg-card text-card-foreground", className)} {...props} />;
}

export function SectionLabel({ className, ...props }) {
  return <div className={cn("text-base font-semibold text-muted-foreground", className)} {...props} />;
}

export function Spinner({ className }) {
  return <span className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary", className)} aria-hidden />;
}

// Vendor or model logo (from the provider catalog, served by our server).
// Falls back to initials when there is no logo or it fails to load.
export function Logo({ src, name = "", size = 36, className }) {
  const initials = String(name).replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "AI";
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white/95 font-bold text-zinc-700", className)}
      style={{ width: size, height: size, fontSize: Math.max(16, Math.round(size * 0.4)) }}
      aria-hidden
    >
      <span>{initials}</span>
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-white object-contain p-1"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}
    </span>
  );
}
